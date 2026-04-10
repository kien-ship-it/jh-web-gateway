import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, useStdout, useAnimation } from "ink";

const JHU_LOGO_LINES = [
  "     ██╗██╗  ██╗    ██╗    ██╗███████╗██████╗ ",
  "     ██║██║  ██║    ██║    ██║██╔════╝██╔══██╗",
  "     ██║███████║    ██║ █╗ ██║█████╗  ██████╔╝",
  "██   ██║██╔══██║    ██║███╗██║██╔══╝  ██╔══██╗",
  "╚█████╔╝██║  ██║    ╚███╔███╔╝███████╗██████╔╝",
  " ╚════╝ ╚═╝  ╚═╝     ╚══╝╚══╝ ╚══════╝╚═════╝ ",
  "",
  "      ██████╗  █████╗ ████████╗███████╗██╗    ██╗ █████╗ ██╗   ██╗",
  "     ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║    ██║██╔══██╗╚██╗ ██╔╝",
  "     ██║  ███╗███████║   ██║   █████╗  ██║ █╗ ██║███████║ ╚████╔╝ ",
  "     ██║   ██║██╔══██║   ██║   ██╔══╝  ██║███╗██║██╔══██║  ╚██╔╝  ",
  "     ╚██████╔╝██║  ██║   ██║   ███████╗╚███╔███╔╝██║  ██║   ██║   ",
  "      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝  ",
];

const SUBTITLES = [
  "// Infinite tokens, for school work of course :)))",
  "// powered by caffeine, desperation, and vibes",
  "// your professor will never know™",
  "// if it works, don't ask why",
  "// technically not cheating if the AI is also confused",
  "// [ERROR 418: I'm a teapot, but make it AI]",
  "// running on 3 hours of sleep and pure audacity",
  "// the tokens are infinite but my GPA is not",
  "// SYSTEM OVERRIDE: homework.exe has been defeated",
  "// now with 40% more hallucinations!",
  "// null pointer? more like null problems 😈",
  "// WARNING: may cause uncontrollable productivity",
  "// all citations are made up but they sound real",
  "// NOT affiliated with Skynet (probably)",
  "// lorem ipsum but it writes your thesis",
  "// sudo make my-homework --grade=A",
  "// ship it. always ship it.",
  "// this is fine 🔥 everything is fine 🔥",
  "// bridging the gap between laziness and genius",
  "// if AI wrote this disclaimer, does it count?",
];

const TAGLINE = SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)]!;
const GLITCH_CHARS = "█▓▒░╬╪╫▲▼◆◇○●□■#@$%&?!~^*";
const STAR_CHARS = ["·", ".", "*", "✦", "✧", "⋆", "+", "×"];
const LOGO_COLORS = ["cyan", "cyan", "blueBright", "blueBright", "blue", "blue", "white", "greenBright", "green", "greenBright", "green", "greenBright", "green"] as const;

const GLITCH_PHASE_MS = 600;
const REVEAL_PHASE_MS = 900;
const TYPEWRITER_INTERVAL_MS = 28;

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function glitchLine(line: string, progress: number, rand: () => number): string {
  return line
    .split("")
    .map((ch) => {
      if (ch === " " || ch === "\n") return ch;
      if (rand() > progress) {
        return GLITCH_CHARS[Math.floor(rand() * GLITCH_CHARS.length)];
      }
      return ch;
    })
    .join("");
}

interface StarfieldProps {
  rows: number;
  cols: number;
  tick: number;
}

function Starfield({ rows, cols, tick }: StarfieldProps): React.ReactElement {
  const rand = seededRand(42);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      const base = rand();
      const twinkleOffset = Math.sin((tick * 0.3 + r * 7.3 + c * 3.7)) * 0.5 + 0.5;
      row += base < 0.025 * twinkleOffset ? STAR_CHARS[Math.floor(rand() * STAR_CHARS.length)] : " ";
    }
    lines.push(row);
  }
  return (
    <Box flexDirection="column" position="absolute" marginTop={0}>
      {lines.map((l, i) => (
        <Text key={i} dimColor color="cyan">{l}</Text>
      ))}
    </Box>
  );
}

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 120;
  const termRows = stdout?.rows ?? 30;

  const [phase, setPhase] = useState<"glitch" | "reveal" | "done">("glitch");
  const [glitchProgress, setGlitchProgress] = useState(0);
  const [revealedLines, setRevealedLines] = useState(0);
  const [typewriterCount, setTypewriterCount] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const skippedRef = useRef(false);

  const { frame: tick } = useAnimation({ interval: 80 });

  const skip = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    setPhase("done");
    setRevealedLines(JHU_LOGO_LINES.length);
    setTypewriterCount(TAGLINE.length);
    setShowCursor(false);
  }, []);

  useInput((_, key) => {
    if (phase !== "done") {
      skip();
    } else {
      onComplete();
    }
  });

  useEffect(() => {
    if (skippedRef.current) return;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(elapsed / GLITCH_PHASE_MS, 1);
      setGlitchProgress(p);
      if (p >= 1) {
        clearInterval(id);
        setPhase("reveal");
      }
    }, 40);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase !== "reveal" || skippedRef.current) return;
    const total = JHU_LOGO_LINES.length;
    let count = 0;
    const id = setInterval(() => {
      count++;
      setRevealedLines(count);
      if (count >= total) {
        clearInterval(id);
        setPhase("done");
      }
    }, Math.round(REVEAL_PHASE_MS / total));
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "done") return;
    if (typewriterCount >= TAGLINE.length) return;
    const id = setInterval(() => {
      setTypewriterCount((p) => {
        if (p >= TAGLINE.length) {
          clearInterval(id);
          return p;
        }
        return p + 1;
      });
    }, TYPEWRITER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase, typewriterCount]);

  useEffect(() => {
    if (phase !== "done") return;
    const id = setInterval(() => setShowCursor((p) => !p), 530);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Starfield rows={termRows} cols={termCols} tick={tick} />

      <Box width="100%" justifyContent="flex-end" paddingRight={2}>
        <Text dimColor color="cyan">v{__APP_VERSION__}</Text>
      </Box>

      <Box flexDirection="column" alignItems="flex-start" paddingLeft={2}>
        {JHU_LOGO_LINES.map((line, i) => {
          let displayLine: string;
          const color = LOGO_COLORS[i] ?? "cyan";

          if (phase === "glitch") {
            const lineRand = seededRand(i * 137 + 11);
            displayLine = glitchLine(line, glitchProgress, lineRand);
          } else if (phase === "reveal") {
            if (i < revealedLines) {
              displayLine = line;
            } else {
              const lineRand = seededRand(i * 137 + 11);
              displayLine = glitchLine(line, 0.0, lineRand);
            }
          } else {
            displayLine = line;
          }

          return (
            <Text key={i} color={color} bold={i < 6}>
              {displayLine}
            </Text>
          );
        })}

        {phase === "done" && (
          <>
            <Box marginTop={1}>
              <Text color="greenBright">
                {"  "}
                {TAGLINE.slice(0, typewriterCount)}
                {showCursor ? "█" : " "}
              </Text>
            </Box>
            {typewriterCount >= TAGLINE.length && (
              <Box marginTop={1}>
                <Text dimColor>  Press any key to continue_</Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
