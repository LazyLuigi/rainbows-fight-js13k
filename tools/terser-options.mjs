// Shared by the build and the Wavedash test, so the test exercises the exact
// options that produce the deliverable. No booleans_as_integers: the Wavedash
// SDK validates argument types and silently rejects a 1 where it expects true.
export default {
  compress: { passes: 3, unsafe: true },
  mangle: { toplevel: true },
  format: { comments: false }
};
