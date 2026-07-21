import { useEffect, useState } from "react";

export function useAsync<T>(factory: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    factory()
      .then((value) => {
        if (alive) {
          setData(value);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (alive) setError(nextError);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, deps);

  return { data, error, loading, setData };
}
