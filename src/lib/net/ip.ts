import { isIP } from "node:net";

// Which network addresses a server-side fetch must never connect to (V2 feature 09 §7): the machine
// itself, private networks, link-local addresses (including the cloud metadata address
// 169.254.169.254), carrier-grade NAT, multicast, reserved and documentation ranges, and the IPv6
// equivalents, including IPv4 addresses written inside an IPv6 one. Pure.

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** [network, prefix length] pairs that are not for the public internet. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network, includes the unspecified address
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, the cloud metadata address
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes the broadcast address
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  if (n === null) return true; // not an address we can reason about: do not connect
  return BLOCKED_V4.some(([network, bits]) => {
    const base = ipv4ToNumber(network)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/** An IPv6 address as eight 16-bit groups, or null if it is not valid. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // A trailing IPv4 part (::ffff:1.2.3.4) is two groups.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const n = ipv4ToNumber(v4[1]!);
    if (n === null) return null;
    text = `${text.slice(0, -v4[1]!.length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return out.some(Number.isNaN) ? null : out;
}

const groupsToV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, hi, lo] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (allZeroUpTo(7) && (lo === 0 || lo === 1)) return true; // :: and ::1
  if (allZeroUpTo(5) && f === 0xffff) return isBlockedV4(groupsToV4(hi, lo)); // ::ffff:a.b.c.d
  if (allZeroUpTo(6)) return isBlockedV4(groupsToV4(hi, lo)); // ::a.b.c.d (deprecated)
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isBlockedV4(groupsToV4(hi, lo)); // NAT64 64:ff9b::/96
  }
  if (a === 0x2002) return isBlockedV4(groupsToV4(b, c)); // 6to4 embeds an IPv4 address
  if (a === 0x2001 && b === 0) return true; // Teredo
  if (a === 0x2001 && b === 0xdb8) return true; // documentation
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True when a connection to this address must be refused. Anything unparseable is refused. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const kind = isIP(bare);
  if (kind === 4) return isBlockedV4(bare);
  if (kind === 6) return isBlockedV6(bare);
  return true;
}

/** The host of a URL as an address when it is one (the URL parser has already normalised decimal, hex and octal forms). */
export function literalAddress(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, "");
  return isIP(bare) ? bare : null;
}
