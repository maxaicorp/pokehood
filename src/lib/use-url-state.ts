// useUrlState — like useState, but the value lives in a URL query param.
//
// Why: bare useState toggles on the Market page sometimes "didn't register" —
// a click set state that got swallowed mid-render or by an in-flight load, so
// the view stayed on the old data and looked stale. Driving the control off the
// URL makes a click a deterministic navigation: setSearchParams updates the URL,
// useSearchParams re-reads it, the view re-renders. Bonus: views become
// shareable + the back button works.
//
// Drop-in for useState<string-union>: same [value, setValue] shape, and setValue
// accepts either a value or an updater fn. When the value equals the default the
// param is removed, so default views keep clean URLs (e.g. "/" not "/?tab=top").

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = (searchParams.get(key) as T | null) ?? defaultValue;

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setSearchParams(
        (prev) => {
          const current = (prev.get(key) as T | null) ?? defaultValue;
          const resolved =
            typeof next === "function" ? (next as (p: T) => T)(current) : next;
          const params = new URLSearchParams(prev);
          if (resolved === defaultValue) params.delete(key);
          else params.set(key, resolved);
          return params;
        },
        // replace:false so each toggle is a history entry → back button steps
        // through the views the user actually visited.
        { replace: false },
      );
    },
    [key, defaultValue, setSearchParams],
  );

  return [value, setValue];
}
