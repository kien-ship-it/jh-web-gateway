import React from "react";
import { Box, Text } from "ink";

interface HeaderBarProps {
  gatewayStatus: "stopped" | "starting" | "running" | "error";
}

export function HeaderBar({ gatewayStatus }: HeaderBarProps): React.ReactElement {
  const dotColor =
    gatewayStatus === "running"
      ? "green"
      : gatewayStatus === "starting"
        ? "yellow"
        : "red";

  const statusLabel =
    gatewayStatus === "running"
      ? "running"
      : gatewayStatus === "starting"
        ? "starting"
        : gatewayStatus === "error"
          ? "error"
          : "stopped";

  return (
    <Box justifyContent="space-between" width="100%">
      <Text bold>jh-gateway</Text>
      <Text>
        <Text color={dotColor}>●</Text>
        {" "}
        <Text>Gateway: {statusLabel}</Text>
      </Text>
    </Box>
  );
}
