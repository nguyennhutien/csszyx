// A binding that reports its identity, as every engine from 0.18 does.
module.exports = {
  ...require("./native-binding.cjs"),
  engineIdentity: () => ({ version: "0.18.0", digest: "aaaaaaaaaaaaaaaa" }),
};
