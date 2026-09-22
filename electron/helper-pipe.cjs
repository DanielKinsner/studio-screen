/**
 * Commands reach the capture helper as lines on its stdin. Returns a sender
 * that reports whether the line could be written.
 *
 * The helper can die mid-take (driver reset, monitor unplugged) a moment
 * before its exit event arrives; a pause or stop sent in that gap fails with
 * EPIPE. Unhandled, that error would crash the main process with an error
 * dialog, so it's absorbed here: the helper's exit event already tells the
 * editor the take ended.
 */
function openHelperPipe(child) {
  child.stdin.on("error", () => {});
  return (line) => {
    if (child.stdin.destroyed || !child.stdin.writable) return false;
    child.stdin.write(line + "\n");
    return true;
  };
}
module.exports = { openHelperPipe };
