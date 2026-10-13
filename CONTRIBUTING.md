# Contributing

Thanks for helping. The most useful contributions right now:

- **Test vectors** from real agent traffic (with keys you're allowed to share)
- **Ports** of the verifier to Python or Go that pass `test-vectors/vectors.json`
- **Protocol updates** when Visa, Mastercard or the AP2 authors publish changes
- **Bug reports** with a request that verifies when it shouldn't, or the other way round

## Getting set up

```bash
git clone https://github.com/provethebuy/provethebuy.git
cd provethebuy
npm install
npm test          # builds, runs unit + CLI tests, checks every vector
npm run demo      # the playground at http://localhost:4319
```

Node 18.17 or newer. No other services needed.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep pull requests focused on one change.
3. Add or update tests. If a change affects a decision, add a vector with `npm run vectors`.
4. Run `npm test` before pushing.
5. Cryptographic code (`httpsig.ts`, `jws.ts`, `mandates/`, `bodyObjects.ts`) needs two approving reviews.

## Style

- TypeScript, ESM, no runtime dependencies in `@provethebuy/verify`.
- No custom cryptography: use WebCrypto.
- Check details are read by merchants. Write them as plain sentences ("Signed 3s ago, valid for 480s."), not codes.

By contributing you agree your work is licensed under Apache-2.0 and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
