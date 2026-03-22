import { useState } from "react";
import { useInterval } from "../hooks/useInterval";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ color = "green" }: { color?: string }) {
  const [tick, setTick] = useState(0);
  useInterval(() => setTick((t) => (t + 1) % FRAMES.length), 100);

  return <text fg={color}>{FRAMES[tick]}</text>;
}
