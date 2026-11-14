import { installErrorReporting } from "./lib/monitoring/client";

/**
 * Before hydration: an error that escapes in the tab goes to /api/errors
 * (#69). Synchronous and light, as the guide asks; it never throws.
 */
installErrorReporting(window);
