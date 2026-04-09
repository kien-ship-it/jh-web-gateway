import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MODEL_ENDPOINT_MAP } from "../../infra/types.js";
import { updateConfig } from "../../infra/config.js";
import { wrapIndex } from "../utils/navigation.js";

const MODELS = Object.keys(MODEL_ENDPOINT_MAP);

interface ModelSelectorProps {
  activeModel: string;
  onSelect: (model: string) => void;
  onBack: () => void;
}

export function ModelSelector({ activeModel, onSelect, onBack }: ModelSelectorProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const idx = MODELS.indexOf(activeModel);
    return idx >= 0 ? idx : 0;
  });
  const [confirmationModel, setConfirmationModel] = useState<string | null>(null);

  useEffect(() => {
    if (confirmationModel !== null) {
      const timer = setTimeout(() => setConfirmationModel(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [confirmationModel]);

  useInput((input, key) => {
    if (key.downArrow) {
      setFocusedIndex((i) => wrapIndex(i, 1, MODELS.length));
    } else if (key.upArrow) {
      setFocusedIndex((i) => wrapIndex(i, -1, MODELS.length));
    } else if (key.return) {
      const selected = MODELS[focusedIndex];
      updateConfig({ defaultModel: selected }).catch(() => {});
      onSelect(selected);
      setConfirmationModel(selected);
    } else if (input === "b" || key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select Model</Text>
      </Box>
      <Box flexDirection="column">
        {MODELS.map((model, index) => {
          const isFocused = index === focusedIndex;
          const isActive = model === activeModel;
          return (
            <Box key={model}>
              <Text color={isFocused ? "cyan" : undefined} bold={isFocused}>
                {isFocused ? "> " : "  "}
                <Text color={isActive ? "green" : "gray"}>{isActive ? "●" : "○"}</Text>
                {" "}
                {model}
              </Text>
            </Box>
          );
        })}
      </Box>
      {confirmationModel !== null && (
        <Box marginTop={1}>
          <Text color="green">✓ Selected: {confirmationModel}</Text>
        </Box>
      )}
    </Box>
  );
}
