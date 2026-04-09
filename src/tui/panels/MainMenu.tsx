import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MENU_ITEMS } from "../types.js";
import { wrapIndex } from "../utils/navigation.js";
import { useAppContext } from "../AppContext.js";
import type { PanelId } from "../types.js";

interface MainMenuProps {
  onQuit: () => void;
}

export function MainMenu({ onQuit }: MainMenuProps): React.ReactElement {
  const { navigate } = useAppContext();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useInput((input, key) => {
    if (key.downArrow) {
      setFocusedIndex((i) => wrapIndex(i, 1, MENU_ITEMS.length));
    } else if (key.upArrow) {
      setFocusedIndex((i) => wrapIndex(i, -1, MENU_ITEMS.length));
    } else if (key.return) {
      const item = MENU_ITEMS[focusedIndex];
      if (item.id === "quit") {
        onQuit();
      } else {
        navigate(item.id as PanelId);
      }
    } else if (input === "q" || key.escape) {
      onQuit();
    }
  });

  const focusedItem = MENU_ITEMS[focusedIndex];

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Main Menu</Text>
      </Box>
      <Box flexDirection="column">
        {MENU_ITEMS.map((item, index) => {
          const isFocused = index === focusedIndex;
          return (
            <Box key={item.id}>
              <Text color={isFocused ? "cyan" : undefined} bold={isFocused}>
                {isFocused ? "> " : "  "}
                {item.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{focusedItem.description}</Text>
      </Box>
    </Box>
  );
}
