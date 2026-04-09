import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAppContext } from "../AppContext.js";
import { updateConfig, validateConfig } from "../../infra/config.js";

interface SettingField {
  key: string;
  label: string;
  getValue: (config: ReturnType<typeof getConfigSnapshot>) => string;
  applyValue: (config: ReturnType<typeof getConfigSnapshot>, raw: string) => Record<string, unknown>;
  validate: (raw: string) => string | null;
}

interface ConfigSnapshot {
  port: number;
  cdpUrl: string;
  defaultModel: string;
  authMode: string;
}

function getConfigSnapshot(config: { port: number; cdpUrl: string; defaultModel: string; auth: { mode: string } }): ConfigSnapshot {
  return {
    port: config.port,
    cdpUrl: config.cdpUrl,
    defaultModel: config.defaultModel,
    authMode: config.auth.mode,
  };
}

const FIELDS: SettingField[] = [
  {
    key: "port",
    label: "Port",
    getValue: (s) => String(s.port),
    applyValue: (_s, raw) => ({ port: parseInt(raw, 10) }),
    validate: (raw) => {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 1 || n > 65535) return "Port must be between 1 and 65535";
      return null;
    },
  },
  {
    key: "cdpUrl",
    label: "CDP URL",
    getValue: (s) => s.cdpUrl,
    applyValue: (_s, raw) => ({ cdpUrl: raw }),
    validate: (raw) => {
      if (!/^https?:\/\//.test(raw)) return "CDP URL must start with http:// or https://";
      return null;
    },
  },
  {
    key: "defaultModel",
    label: "Default Model",
    getValue: (s) => s.defaultModel,
    applyValue: (_s, raw) => ({ defaultModel: raw }),
    validate: (raw) => {
      if (!raw.trim()) return "Model must be a non-empty string";
      return null;
    },
  },
  {
    key: "authMode",
    label: "Auth Mode",
    getValue: (s) => s.authMode,
    applyValue: (_s, raw) => ({ auth: { mode: raw } }),
    validate: (raw) => {
      if (raw !== "none" && raw !== "bearer" && raw !== "basic")
        return 'Auth mode must be "none", "bearer", or "basic"';
      return null;
    },
  },
];

export function SettingsPanel(): React.ReactElement {
  const { state, navigate, setConfig } = useAppContext();
  const { config } = state;

  const snapshot = getConfigSnapshot(config);

  const [focusedField, setFocusedField] = useState(0);
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  const confirmEdit = async () => {
    if (editingField === null) return;
    const field = FIELDS[editingField];

    const validErr = field.validate(editValue);
    if (validErr) {
      setFieldError(validErr);
      return;
    }

    const partial = field.applyValue(snapshot, editValue);

    try {
      const merged = { ...config, ...partial } as Record<string, unknown>;
      if ("auth" in partial && typeof partial.auth === "object") {
        merged.auth = { ...config.auth, ...(partial.auth as Record<string, unknown>) };
      }
      validateConfig(merged);
      await updateConfig(partial as Parameters<typeof updateConfig>[0]);

      const updatedConfig = { ...config, ...partial } as typeof config;
      if ("auth" in partial && typeof partial.auth === "object") {
        updatedConfig.auth = { ...config.auth, ...(partial.auth as { mode?: "none" | "bearer" | "basic"; token?: string | null }) };
      }
      setConfig(updatedConfig);
      setSavedField(field.key);
      setTimeout(() => setSavedField(null), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      setTimeout(() => setSaveError(null), 3000);
      return;
    }

    setEditingField(null);
    setEditValue("");
    setFieldError(null);
  };

  useInput((_input, key) => {
    if (editingField !== null) {
      if (key.escape) {
        setEditingField(null);
        setEditValue("");
        setFieldError(null);
        return;
      }
      if (key.return) {
        void confirmEdit();
        return;
      }
      if (key.backspace || key.delete) {
        setEditValue((prev) => prev.slice(0, -1));
        setFieldError(null);
        return;
      }
      if (_input && !key.ctrl && !key.meta) {
        setEditValue((prev) => prev + _input);
        setFieldError(null);
        return;
      }
      return;
    }

    if (key.downArrow) {
      setFocusedField((i) => (i + 1) % FIELDS.length);
      return;
    }
    if (key.upArrow) {
      setFocusedField((i) => (i - 1 + FIELDS.length) % FIELDS.length);
      return;
    }
    if (key.return) {
      const field = FIELDS[focusedField];
      setEditValue(field.getValue(snapshot));
      setEditingField(focusedField);
      setFieldError(null);
      return;
    }
    if (_input === "b" || key.escape) {
      navigate("menu");
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Settings</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {FIELDS.map((field, index) => {
          const isFocused = index === focusedField;
          const isEditing = editingField === index;
          const currentValue = field.getValue(snapshot);
          const isSaved = savedField === field.key;

          return (
            <Box key={field.key} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isFocused ? "cyan" : undefined} bold={isFocused}>
                  {isFocused ? "> " : "  "}
                  <Text bold>{field.label}: </Text>
                  {isEditing ? (
                    <Text color="cyan">
                      {editValue}
                      <Text color="cyan">█</Text>
                    </Text>
                  ) : (
                    <Text color={isSaved ? "green" : undefined}>
                      {currentValue}
                      {isSaved ? "  ✓" : ""}
                    </Text>
                  )}
                </Text>
              </Box>
              {isEditing && fieldError && (
                <Box marginLeft={4}>
                  <Text color="red">{fieldError}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {saveError && (
        <Box marginBottom={1}>
          <Text color="red">{saveError}</Text>
        </Box>
      )}

      <Box>
        {editingField !== null ? (
          <Text dimColor>[Enter] Confirm  [Esc] Cancel</Text>
        ) : (
          <Text dimColor>[↑↓] Navigate  [Enter] Edit  [b/Esc] Back</Text>
        )}
      </Box>
    </Box>
  );
}
