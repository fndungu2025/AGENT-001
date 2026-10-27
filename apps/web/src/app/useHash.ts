import { useEffect, useState } from "react";

function current(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

/** Tiny hash router state: returns the hash without "#" and a setter. */
export function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(current);
  useEffect(() => {
    const on = () => {
      setHash(current());
    };
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("hashchange", on);
    };
  }, []);
  const set = (h: string) => {
    if (window.location.hash.replace(/^#\/?/, "") !== h) window.location.hash = h;
    else setHash(h);
  };
  return [hash, set];
}
