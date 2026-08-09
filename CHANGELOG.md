# Changelog

## [1.6.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.5.0...v1.6.0) (2026-08-09)


### Features

* adopt GitHub Checks API for review status ([ae00f48](https://github.com/thalesraymond/jules-pr-reviewer/commit/ae00f48877ec8fc8e9a298db472c65ca6e575f9d)), closes [#113](https://github.com/thalesraymond/jules-pr-reviewer/issues/113)
* **dedup:** dedplucation feat ([#132](https://github.com/thalesraymond/jules-pr-reviewer/issues/132)) ([6536068](https://github.com/thalesraymond/jules-pr-reviewer/commit/65360680675c72aa0510965e13915b50d783044e))
* harden concurrency ([#134](https://github.com/thalesraymond/jules-pr-reviewer/issues/134)) ([637bd30](https://github.com/thalesraymond/jules-pr-reviewer/commit/637bd3022fdb6648c134f73e4089b83e59a4293f))
* large pr handling ([#133](https://github.com/thalesraymond/jules-pr-reviewer/issues/133)) ([f618fe6](https://github.com/thalesraymond/jules-pr-reviewer/commit/f618fe638201e6fca6ed71102fe483c17c355f3a))
* ticket 113 ([d399580](https://github.com/thalesraymond/jules-pr-reviewer/commit/d399580712c2b99df1f8cb3d1b436b22a6acff6f))

## [1.5.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.4.0...v1.5.0) (2026-08-07)


### Features

* **agent:** add agentic mode ([d7197be](https://github.com/thalesraymond/jules-pr-reviewer/commit/d7197be6ac8283b59a0040ce2b30117dfa6761f7)), closes [#103](https://github.com/thalesraymond/jules-pr-reviewer/issues/103)
* improve jules context ([35aa78c](https://github.com/thalesraymond/jules-pr-reviewer/commit/35aa78c765857cee34c5433dd45e31af8eec63bb))


### Bug Fixes

* **agentic mode:** fix rule for retry/fallback ([610befe](https://github.com/thalesraymond/jules-pr-reviewer/commit/610befe96ae8edddbc46dab3ba763e3f34e43808))
* **agentic mode:** small fixes ([bdd2769](https://github.com/thalesraymond/jules-pr-reviewer/commit/bdd27691509305fa3a51702ef1bc118226f6c028))
* **archive:** make sure fallback sessions are also archived ([71ea5b2](https://github.com/thalesraymond/jules-pr-reviewer/commit/71ea5b2bc8c5331bb36e80e8c6697b8adbe07169))
* fixes agentic changes ([759813a](https://github.com/thalesraymond/jules-pr-reviewer/commit/759813a60ed01e71ff57ac1118ec44cdca8eb091))

## [1.4.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.3.0...v1.4.0) (2026-08-06)


### Features

* add and integrate strict runtime validation for LLM JSON responses ([a348505](https://github.com/thalesraymond/jules-pr-reviewer/commit/a3485055076ea4bd055dc70f87ea41ec29cbf397))
* add resilient Jules JSON payload extraction ([e36e44b](https://github.com/thalesraymond/jules-pr-reviewer/commit/e36e44be19c61661d29e60a33f2e708df189764a))
* better logs ([25d3b60](https://github.com/thalesraymond/jules-pr-reviewer/commit/25d3b604e9fc59d47fa656f2be02052ffa1e1279))
* **code-review:** added suggested changes to jules response ([d1849db](https://github.com/thalesraymond/jules-pr-reviewer/commit/d1849dbdf7d4fa97aa99013fcfc87a3e56a5d816))
* fix formatting issues in src/utils.ts and tests/jules.test.ts ([a01245e](https://github.com/thalesraymond/jules-pr-reviewer/commit/a01245e8b3043bab317fc551efa75a94eee8bf5c))
* github code suggestion ([d617fe3](https://github.com/thalesraymond/jules-pr-reviewer/commit/d617fe3ece873376d6c1cae67b40fd6384640087))
* **json-validation:** enable json validation and fallback ([e0331d5](https://github.com/thalesraymond/jules-pr-reviewer/commit/e0331d563cd5ff78412e3546e759cf9f6194ecff))
* **jules:** retry logic ([58f5081](https://github.com/thalesraymond/jules-pr-reviewer/commit/58f50818f2b3307704b4a934dcf05281358a3f22))
* **logs:** improve logs ([ffcb246](https://github.com/thalesraymond/jules-pr-reviewer/commit/ffcb246e7e1fc2a4faacbdad414a28423fba5b18))
* **utils:** add getErrorMessage utility and integrate it across files ([3ce857a](https://github.com/thalesraymond/jules-pr-reviewer/commit/3ce857a5ea7b800235c22d50a4bec47b07facfbc))


### Bug Fixes

* **code-review:** fix action beign unable to parse on multilayer code blocks ([d2e6187](https://github.com/thalesraymond/jules-pr-reviewer/commit/d2e61874346070fbfbae8497609b27691bf44f94))
* pass title property to session create payload to satisfy preconditions ([df96c9b](https://github.com/thalesraymond/jules-pr-reviewer/commit/df96c9b60481d425935cbbf074c0abc0c019214a))
* **sec:** match tag with space ([5792f97](https://github.com/thalesraymond/jules-pr-reviewer/commit/5792f9781e30fcf9a8f2026c16503b62665c734e))
* **security:** sanitize promptForAgents to prevent HTML injection ([a20dfc6](https://github.com/thalesraymond/jules-pr-reviewer/commit/a20dfc674c6006ea40a1cffce4c26ec5dc1db765))

## [1.3.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.2.0...v1.3.0) (2026-07-25)


### Features

* 🚀 Catalyst: [Enhancement] Add and integrate withRetry utility ([99e59f8](https://github.com/thalesraymond/jules-pr-reviewer/commit/99e59f8365bfb552d755a53cfcab2c860105986b))
* **action:** new parameter for ignored paths ([fad749f](https://github.com/thalesraymond/jules-pr-reviewer/commit/fad749f53fcf3cab7fb6b8831e240daa25165b06))
* **action:** new parameter for ignored paths ([a2076c0](https://github.com/thalesraymond/jules-pr-reviewer/commit/a2076c0dbe550232164eb0e69ccd83ffbf81f7ce))
* add withFallback utility and integrate into submitReview ([e338834](https://github.com/thalesraymond/jules-pr-reviewer/commit/e33883456878c8985a4953ebd2bdaa4828ce9479))
* add withRetry utility and integrate into github API mutations ([ca5e62f](https://github.com/thalesraymond/jules-pr-reviewer/commit/ca5e62fac639160bed1cebfc2e1cca7a5ab211f7))
* **packages:** update all outdated packages ([ce933b2](https://github.com/thalesraymond/jules-pr-reviewer/commit/ce933b213aeec993867bc75fac65443a486675d4))


### Bug Fixes

* 🔒 prevent comment spoofing by validating author ([6368835](https://github.com/thalesraymond/jules-pr-reviewer/commit/636883531fe15fa0c7a98bcfc2e2cf1ad3bcd012))
* **ci:** fix error on setup node ([3b7f18e](https://github.com/thalesraymond/jules-pr-reviewer/commit/3b7f18e60a9e15099182a58ec46c7509f62b8913))
* **oktokit:** optime octokit init ([d9a2233](https://github.com/thalesraymond/jules-pr-reviewer/commit/d9a22334c143b3bee11d34ab0094fb80ba76b2e5))
* **pnpm:** remove invalid config ([a12569d](https://github.com/thalesraymond/jules-pr-reviewer/commit/a12569d34db7c9c58c3813728d0a0607fbe10e89))
* securely format error strings in public commit status ([635b55e](https://github.com/thalesraymond/jules-pr-reviewer/commit/635b55e02e77c46509c079cbbb2b24e906cc75f6))


### Performance Improvements

* optimize early returns and instantiation ([a926605](https://github.com/thalesraymond/jules-pr-reviewer/commit/a92660515ee5c40239593eccdae00766d5e1e871))
* optimize early returns to prevent wasteful allocations ([6b93386](https://github.com/thalesraymond/jules-pr-reviewer/commit/6b933868c9c156e6ab6f1fbc5f260d6cb508964c))
* parallelize independent github api requests ([0cb6436](https://github.com/thalesraymond/jules-pr-reviewer/commit/0cb6436d00ab46fef922575201f8e90c15e04bdf))

## [1.2.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.1.0...v1.2.0) (2026-06-15)


### Features

* dummy-commit ([f334a6f](https://github.com/thalesraymond/jules-pr-reviewer/commit/f334a6ff0da28f8272c28d6ca918d69e9e4da3a8))

## [1.1.0](https://github.com/thalesraymond/jules-pr-reviewer/compare/v1.0.0...v1.1.0) (2026-06-14)


### Features

* **comment:** avoid errors if jules dont respect json format ([f4e3c74](https://github.com/thalesraymond/jules-pr-reviewer/commit/f4e3c74e50e59f692fb7dba6109155b04951c869))
* invalid json check ([aeacfc5](https://github.com/thalesraymond/jules-pr-reviewer/commit/aeacfc57cc5de06bafb760fde84b45975319c02f))

## 1.0.0 (2026-06-14)


### Features

* add prompt for agents to feedback ([f9f88a2](https://github.com/thalesraymond/jules-pr-reviewer/commit/f9f88a2e57b1dbadd435d96e2c315eced3187a33))
* **jules:** add instructions for AI Agents on return from review ([cb72b3d](https://github.com/thalesraymond/jules-pr-reviewer/commit/cb72b3d1495254461eb859ca3a8e188b60de3958))
* **tests/ci:** setup unit tests / husky / git cz / release-please ([32c9857](https://github.com/thalesraymond/jules-pr-reviewer/commit/32c9857db2a9f779b0554ecc8f51bbeb431833ce))


### Bug Fixes

* **ci:** add checkout to self test ([b65eb20](https://github.com/thalesraymond/jules-pr-reviewer/commit/b65eb20ab4fe3fb7d95f333d1357b100fad632c7))
