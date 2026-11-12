"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { TOKEN_FIELD } from "@/lib/turnstile";

/** The part of Cloudflare's global this widget uses (explicit rendering). */
type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "response-field": boolean;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

function turnstile(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare Turnstile, rendered explicitly so it can be reset: a token is
 * good for one check, and every answer of the action (an error included)
 * spends it. `resetKey` changes on every answer, and the widget starts over.
 *
 * The token goes into the form as TOKEN_FIELD, through a hidden input of our
 * own, and `onToken` tells the form whether there is one.
 */
export function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
}: {
  readonly siteKey: string;
  readonly resetKey: unknown;
  readonly onToken: (present: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    const api = turnstile();
    if (!loaded || !api || !container.current || widget.current !== null) {
      return;
    }
    const set = (value: string) => {
      setToken(value);
      onToken(value !== "");
    };
    widget.current = api.render(container.current, {
      sitekey: siteKey,
      callback: set,
      "expired-callback": () => set(""),
      "error-callback": () => set(""),
      "response-field": false,
    });
    return () => {
      if (widget.current !== null) {
        api.remove(widget.current);
        widget.current = null;
      }
    };
  }, [loaded, siteKey, onToken]);

  useEffect(() => {
    const api = turnstile();
    if (api && widget.current !== null) {
      api.reset(widget.current);
      setToken("");
      onToken(false);
    }
  }, [resetKey, onToken]);

  return (
    <>
      <Script
        src={SCRIPT}
        onReady={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
      <div ref={container} className="min-h-[65px]" />
      <input type="hidden" name={TOKEN_FIELD} value={token} />
    </>
  );
}
