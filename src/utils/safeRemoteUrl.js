const dns = require('dns').promises;
const { URL } = require('url');
const net = require('net');

function isPrivateIp(ip) {
  const addr = String(ip || '').replace(/^::ffff:/, '');
  if (net.isIP(addr) === 0) return true;
  if (addr === '127.0.0.1' || addr === '0.0.0.0' || addr === '::1') return true;
  if (addr.startsWith('10.')) return true;
  if (addr.startsWith('192.168.')) return true;
  if (addr.startsWith('169.254.')) return true;
  const parts = addr.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (addr.toLowerCase().startsWith('fc') || addr.toLowerCase().startsWith('fd')) return true;
  return false;
}

/**
 * Only public https URLs. Blocks localhost, private IPs, and metadata hosts.
 */
async function assertSafeHttpsUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Invalid calendar URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Calendar URL must use https.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    throw new Error('Calendar URL host is not allowed.');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Calendar URL host is not allowed.');
  }
  try {
    const looked = await dns.lookup(host, { all: true });
    if (!looked.length || looked.some((r) => isPrivateIp(r.address))) {
      throw new Error('Calendar URL host is not allowed.');
    }
  } catch (err) {
    if (err.message && err.message.includes('not allowed')) throw err;
    throw new Error('Could not resolve calendar URL.');
  }
  return parsed.toString();
}

module.exports = { assertSafeHttpsUrl, isPrivateIp };
