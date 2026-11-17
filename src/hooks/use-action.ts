import { useRef, useState } from "react";
import { describeError } from "@/api/errors";

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setPending(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (error) {
      setError(describeError(error));
      return false;
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return { pending, error, run };
}
