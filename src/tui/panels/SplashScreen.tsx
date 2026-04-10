import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

const JHU_LOGO = `
     ██╗██╗  ██╗    ██╗    ██╗███████╗██████╗
     ██║██║  ██║    ██║    ██║██╔════╝██╔══██╗
     ██║███████║    ██║ █╗ ██║█████╗  ██████╔╝
██   ██║██╔══██║    ██║███╗██║██╔══╝  ██╔══██╗
╚█████╔╝██║  ██║    ╚███╔███╔╝███████╗██████╔╝
 ╚════╝ ╚═╝  ╚═╝     ╚══╝╚══╝ ╚══════╝╚═════╝

      ██████╗  █████╗ ████████╗███████╗██╗    ██╗ █████╗ ██╗   ██╗
     ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║    ██║██╔══██╗╚██╗ ██╔╝
     ██║  ███╗███████║   ██║   █████╗  ██║ █╗ ██║███████║ ╚████╔╝
     ██║   ██║██╔══██║   ██║   ██╔══╝  ██║███╗██║██╔══██║  ╚██╔╝
     ╚██████╔╝██║  ██║   ██║   ███████╗╚███╔███╔╝██║  ██║   ██║
      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝
`.replace(/^\n/, '');

const ANIMATION_DURATION_MS = 500;

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps): React.ReactElement {
  const [revealedCount, setRevealedCount] = useState(0);
  const [animationComplete, setAnimationComplete] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalChars = JHU_LOGO.length;

  useEffect(() => {
    const stepMs = 16; // ~60fps
    const charsPerStep = Math.max(1, Math.ceil(totalChars / (ANIMATION_DURATION_MS / stepMs)));

    intervalRef.current = setInterval(() => {
      setRevealedCount((prev) => {
        const next = prev + charsPerStep;
        if (next >= totalChars) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setAnimationComplete(true);
          return totalChars;
        }
        return next;
      });
    }, stepMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [totalChars]);

  useInput((_, key) => {
    if (!animationComplete) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setRevealedCount(totalChars);
      setAnimationComplete(true);
    } else {
      onComplete();
    }
  });

  const displayedLogo = JHU_LOGO.slice(0, revealedCount);

  return (
    <Box flexDirection="column" alignItems="flex-start" justifyContent="center" width="100%" height="100%">
      <Box marginTop={2} />
      <Text color="blue">{displayedLogo}</Text>
      {animationComplete && (
        <>
          <Box marginTop={1}>
            <Text color="cyan" italic>     Infinite tokens, for school work of course :)))</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press any key to continue</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
