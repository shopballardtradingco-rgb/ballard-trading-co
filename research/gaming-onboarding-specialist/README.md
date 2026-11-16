# Gaming Onboarding Specialist

**Public-source research scaffold | November 15, 2026**

A searchable, versioned regulatory intelligence project covering U.S. online gaming types and payment-provider implications. It is intended to support research and merchant-onboarding preparation, **not** replace counsel or establish a merchant's legal eligibility.

This project is published in its own folder. It is **independent of the Ballard Trading Co. application, source code, and inventory**; no operational integration or deployment is implied.

## Start here
- [Project description](PROJECT_DESCRIPTION.md)
- [Research instructions](PROJECT_INSTRUCTIONS.md)
- [Claude handoff](CLAUDE_HANDOFF.md)
- [Claude import guide](CLAUDE_IMPORT_GUIDE.md)
- [Download complete Claude ZIP](Gaming_Onboarding_Specialist_Claude_Export.zip)
- [Download original XLSX workbook](Gaming_Onboarding_Specialist_Research_Starter.xlsx)
- [Coverage matrix](data/coverage-matrix.csv)
- [Legal findings](data/legal-findings.csv)
- [Source registry](data/source-registry.csv)
- [Change log](data/change-log.csv)

## Scope and honest coverage
- 50 U.S. states + District of Columbia
- 12 gaming categories = **612 planned jurisdiction/category cells**
- **3 initially researched state-category cells**; the remaining **609 cells are unresearched** at this starter checkpoint
- Additional federal and regulator source seeds in the workbook
- **No national legality clearance**. Unknown is not authorized.

## Workbook data
The original research starter workbook contains 10 sheets. This public Git version exports **all 10 sheet datasets as CSV**, preserving the editable research content for Git diff and machine-readable queries:

| Original sheet | Git file |
|---|---|
| Coverage Matrix | [data/coverage-matrix.csv](data/coverage-matrix.csv) |
| Legal Findings | [data/legal-findings.csv](data/legal-findings.csv) |
| Source Registry | [data/source-registry.csv](data/source-registry.csv) |
| Gaming Taxonomy | [data/gaming-taxonomy.csv](data/gaming-taxonomy.csv) |
| Change Log | [data/change-log.csv](data/change-log.csv) |
| Merchant Intake | [data/merchant-intake.csv](data/merchant-intake.csv) |
| Query Playbook | [data/query-playbook.csv](data/query-playbook.csv) |
| Roadmap | [data/roadmap.csv](data/roadmap.csv) |
| Dashboard | [data/dashboard.csv](data/dashboard.csv) |
| Start Here | [data/start-here.csv](data/start-here.csv) |

The CSV files are text exports of the original workbook, suitable for diffing and machine queries. The original **[formatted XLSX workbook](Gaming_Onboarding_Specialist_Research_Starter.xlsx)** and **[complete Claude export ZIP](Gaming_Onboarding_Specialist_Claude_Export.zip)** are also included here as downloadable binary files.

## Research process
Capture → deduplicate → verify with primary authority → classify legal event and effective dates → assess operator and payment-chain implications → review legal uncertainty → version change log → test answer quality.

Separately assess **operator legality** and **payment processor/vendor obligations**. Keep proposed rules distinct from final rules, enactment distinct from effective date, and litigation posture dated.

## Claude
Create a Claude Project called *Gaming Onboarding Specialist*, add the project instructions and handoff documents, and upload the CSVs (or the original XLSX from the handoff). See [Claude import guide](CLAUDE_IMPORT_GUIDE.md). Do not claim an existing ChatGPT automation is active in Claude.

## Privacy and publication boundary
Only public legal research and generic project-design instructions belong here. No employer-specific merchant lists, internal policies, production access, credentials, unpublished legal opinions, or sensitive customer records. Publication of this research does not signal employer approval or a compliance opinion.

## Monitoring
A separate ChatGPT regulatory-change watch was configured. This public repository is **not automatically synchronized** by that task. Any proposed automation or data updates must be implemented and verified separately.
