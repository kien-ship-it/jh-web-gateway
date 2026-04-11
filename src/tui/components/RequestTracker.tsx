import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import {
    formatElapsed,
    formatQueueDepth,
    type RequestEntry,
} from "../../core/request-activity-tracker.js";

// ── Spinner ────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getSpinnerFrame(): string {
    return SPINNER_FRAMES[Math.floor(Date.now() / 100) % SPINNER_FRAMES.length];
}

// ── RequestEntryRow ────────────────────────────────────────────────────────────

interface RequestEntryRowProps {
    entry: RequestEntry;
    tick: number;
}

function RequestEntryRow({ entry, tick: _tick }: RequestEntryRowProps): React.ReactElement {
    const elapsed =
        entry.status === "active"
            ? formatElapsed(Date.now() - entry.startTime)
            : entry.elapsedMs !== null
                ? formatElapsed(entry.elapsedMs)
                : "";

    if (entry.status === "active") {
        return (
            <Text>
                <Text color="yellow">{getSpinnerFrame()}</Text>
                {" "}
                <Text>{entry.method}</Text>
                {" "}
                <Text dimColor>{entry.path}</Text>
                {"  "}
                <Text color="yellow">{elapsed}</Text>
            </Text>
        );
    }

    const codeColor =
        entry.statusCode !== null && entry.statusCode >= 200 && entry.statusCode < 300
            ? "green"
            : "red";

    return (
        <Text>
            <Text color={codeColor}>{entry.statusCode ?? "???"}</Text>
            {" "}
            <Text>{entry.method}</Text>
            {" "}
            <Text dimColor>{entry.path}</Text>
            {"  "}
            <Text dimColor>{elapsed}</Text>
        </Text>
    );
}

// ── RequestTracker ─────────────────────────────────────────────────────────────

const VISIBLE_ROWS = 8;

export function RequestTracker(): React.ReactElement {
    const { state } = useAppContext();
    const { requestTracker: tracker, requestQueue: queue, gatewayStatus } = state;
    const online = gatewayStatus === "running";

    const [entries, setEntries] = useState<ReadonlyArray<RequestEntry>>([]);

    useEffect(() => {
        if (!tracker) {
            setEntries([]);
            return;
        }
        setEntries(tracker.getEntries());
        const unsub = tracker.subscribe((snapshot) => setEntries(snapshot));
        return unsub;
    }, [tracker]);

    // Live elapsed tick — 200ms interval while any entry is active
    const [tick, setTick] = useState(0);
    const hasActive = entries.some((e) => e.status === "active");

    useEffect(() => {
        if (!hasActive) return;
        const id = setInterval(() => setTick((t) => t + 1), 200);
        return () => clearInterval(id);
    }, [hasActive]);

    // Scroll offset
    const [scrollOffset, setScrollOffset] = useState(0);
    const maxOffset = Math.max(0, entries.length - VISIBLE_ROWS);

    useEffect(() => {
        setScrollOffset((prev) => Math.min(prev, maxOffset));
    }, [maxOffset]);

    useInput((_input, key) => {
        if (_input === "j" || key.downArrow) {
            setScrollOffset((prev) => Math.min(prev + 1, maxOffset));
        }
        if (_input === "k" || key.upArrow) {
            setScrollOffset((prev) => Math.max(prev - 1, 0));
        }
    });

    const visibleEntries = entries.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
    const queueDepth = formatQueueDepth(queue?.pending ?? 0, online);

    return (
        <Box flexDirection="column">
            <Text bold>Server Activity</Text>
            <Text dimColor>{queueDepth}</Text>

            {!online && (
                <Box marginTop={1}>
                    <Text color="red">Gateway offline</Text>
                </Box>
            )}

            {online && entries.length === 0 && (
                <Box marginTop={1}>
                    <Text dimColor>No recent activity</Text>
                </Box>
            )}

            {entries.length > 0 && (
                <Box height={VISIBLE_ROWS} overflowY="hidden" flexDirection="column" marginTop={1}>
                    {visibleEntries.map((entry) => (
                        <RequestEntryRow key={entry.id} entry={entry} tick={tick} />
                    ))}
                </Box>
            )}

            {entries.length > VISIBLE_ROWS && (
                <Text dimColor>
                    ↑↓/jk to scroll ({scrollOffset + 1}–{Math.min(scrollOffset + VISIBLE_ROWS, entries.length)} of {entries.length})
                </Text>
            )}
        </Box>
    );
}
