import { isIP } from "node:net";

/**
 * Is this address one the server must refuse to connect to?
 *
 * Kept apart from the fetching so it is a pure predicate over a string: the
 * ranges are fiddly, the consequences of getting a boundary wrong are either a
 * blocked real site or an open door to the private network, and neither is
 * something to discover in production. Nothing here touches the network, so
 * the tests don't have to either.
 */
/** Reserved ranges, in the form the address parsers actually hand back. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
      (a === 169 && b === 254) ||             // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224                                 // multicast and reserved
    );
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (ip6 === "::" || ip6 === "::1") return true;
    // Mapped IPv4 carries the v4 rules with it.
    const mapped = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      ip6.startsWith("fc") || ip6.startsWith("fd") || // unique local
      ip6.startsWith("fe8") || ip6.startsWith("fe9") ||
      ip6.startsWith("fea") || ip6.startsWith("feb") || // link-local
      ip6.startsWith("ff")                              // multicast
    );
  }
  return true; // unparseable is not provably public
}
