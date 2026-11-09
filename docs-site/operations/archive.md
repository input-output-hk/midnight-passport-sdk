# History and page migration

The primary guides describe published `0.1.0-rc8`. [Later source work](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/source-preview.md) is evaluated separately. Earlier [RC7](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/release-notes-rc7.md), [RC6](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/release-notes-rc6.md), [RC5](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/release-notes-rc5.md), and [RC4](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/release-notes-rc4.md) notes remain historical evidence, not current integration instructions. Native run reports and operator journals remain in the repository review/release directories and are outside this site's learning navigation.

The old Jekyll site used top-level paths such as `/getting-started/`, `/api/`, and `/keys/`. The build emits compatibility pages at every old permalink, including its historical heading IDs. Each page points to the new task guide; links with old fragments still land on an indexed compatibility anchor. The [migration map](/MIGRATION) records every destination.

| Old entry | New primary guide |
| --- | --- |
| `/`, `/getting-started/`, `/library-guide/` | [Overview](/getting-started/) and [first integration](/getting-started/first-integration) |
| `/packages/`, `/api/`, `/capabilities/` | [Package selection](/packages/) and [public operations](/packages/api) |
| `/architecture/`, `/account-keys/` | [Architecture](/architecture/) and [keys/wallets](/architecture/keys-wallets) |
| `/demo-guide/`, `/use-cases/`, `/demo-ui/` | [Reference demo](/demo/) and [scenarios](/demo/scenarios) |
| `/keys/`, `/service/`, `/service-jobs/` | [Artifacts](/operations/artifacts) and [services](/operations/services) |
| `/release-notes-rc*/`, `/live-qualification/`, `/handover/` | This history index, then the tagged source/evidence |

Detailed source-specific material remains linked at its exact release tag where it matters. This site does not copy normative standards or pretend a later checkout was shipped in RC8.
