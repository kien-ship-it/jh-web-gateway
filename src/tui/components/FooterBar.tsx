import React from "react";
import { Box, Text } from "ink";
import type { FooterShortcut } from "../types.js";

interface FooterBarProps {
  shortcuts: FooterShortcut[];
}

export function FooterBar({ shortcuts }: FooterBarProps): React.ReactElement {
  return (
    <Box width="100%" gap={2}>
      {shortcuts.map((s) => (
        <Text key={s.key}>
          <Text dimColor>{"["}</Text>
          <Text bold>{s.key}</Text>
          <Text dimColor>{"]"}</Text>
          {" "}
          <Text>{s.label}</Text>
        </Text>
      ))}
    </Box>
  );
}
