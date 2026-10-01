# David Kurtz's portfolio

A dependency-free static homepage for **David Kurtz / [djaykurtz](https://github.com/djaykurtz)**, intended for **https://djaykurtz.github.io/**.

## Contents

- `site/index.html`: six navigable movements, project context, native expandable inspection panels, repository links, and demo links.
- `site/styles.css`: responsive layout, authored capstone visual vocabulary, keyboard focus, reduced-motion support, and print styles.
- `site/capstone.js`: progressive enhancement for the Azure Local guided lightbox.
- `site/favicon.svg`: locally served favicon.
- `site/assets/ans-choco-architecture.png`: source-grounded ANS-CHOCO architecture screenshot.
- `site/assets/cohort-governance.png`: OFFLINE / SYNTHETIC research/decisions inspector screenshot.
- `site/assets/cohort-tasks.png`: earlier task screenshot retained for existing image-link compatibility.
- `site/assets/azure-local-architecture.png`: static Azure Local platform capstone screenshot.
- `.github/workflows/pages.yml`: official GitHub Pages Actions workflow; uploads **only `site`**.

There is no build step, runtime dependency, external font, CDN, analytics, form submission, or backend connection. The small local script enhances the Azure presentation link; the portfolio and direct-viewer links remain usable without it.

## Design identity

The homepage deliberately adapts David's authored Azure Local capstone movement design: warm charcoal shell (`#16161b`), panel (`#1b1b21`), warm ink (`#ece8e1`), soft and dim text, fine white-alpha dividers, UI sans-serif and Cascadia/SF monospace stacks, compact labels, a movement rail, and progressive disclosure.

Unlike the capstone's fixed presentation canvas, this page reflows into a scrolling mobile layout. Native links and `details` keep navigation and inspection functional without JavaScript. The five connection-kind tokens retain their capstone semantics; they are not assigned as project or health colors. Only the orange work-pathway marker is used in the text-only overview. There are no ambient particles, auto-advancing scenes, or decorative status indicators on the homepage.

Primary reading text uses an 18px target with 1.65 leading at the browser's default 16px base. Essential labels, controls, and inspection headings are at least 16px; only incidental badges and footer metadata use 14px. Text columns are bounded, and the layout reflows instead of scaling or reducing text on narrower screens. Scope caveats and screenshot explanations are reading content, not fine print.

## Local preview

From this repository's root:

```powershell
python -m http.server 8080 --bind 127.0.0.1 --directory .\site
```

Open `http://127.0.0.1:8080/`. Relative asset paths also allow opening `site\index.html` directly. In local HTTP or file previews, the Azure action opens the canonical hosted guided viewer; the preview server does not host the separate Azure project. The in-place portfolio lightbox is enabled only at `https://djaykurtz.github.io/`, where its same-origin viewer contract is available.

## Static hosting

The Pages workflow publishes only `site/`. Supporting repository documentation and workflow files are not part of the deployed website.

Before release, verify the project Pages destinations and deploy this homepage before publishing the profile's screenshot references. Intended demo destinations do not indicate a completed release.

The personal repository is `djaykurtz/djaykurtz.github.io`, with `main` as its publication branch and **GitHub Actions** as the GitHub Pages source. If the chosen branch differs, update the workflow's branch filter before publishing. The upload job uses `contents: read` and `pages: read` to retrieve Pages configuration; only the deploy job receives `pages: write` and `id-token: write`. Deployments use the `github-pages` environment and serialized `pages` concurrency.

The project URLs are intended publication destinations. Verify they are available before launch:

| Project | Repository | Public presentation |
| --- | --- | --- |
| COHORT | https://github.com/djaykurtz/COHORT | https://djaykurtz.github.io/COHORT/ |
| ANS-CHOCO | https://github.com/djaykurtz/ANS-CHOCO | https://djaykurtz.github.io/ANS-CHOCO/ |
| Azure Local POC | https://github.com/djaykurtz/AZLOCAL-POC | https://djaykurtz.github.io/AZLOCAL-POC/ |

COHORT's project story is at the overview URL above; its functional disconnected sample is at https://djaykurtz.github.io/COHORT/demo/.

Its source-linked system atlas is at https://djaykurtz.github.io/COHORT/systems/, and the research/decisions inspector opens at https://djaykurtz.github.io/COHORT/demo/?view=governance. The atlas maps documented/exported boundaries and runtime availability, not a complete coordinator/database reconstruction. Waves are deliberation, votes are audit evidence, and backend ratification/authority enforcement is not bundled.

The homepage distinguishes implementation context from public presentation. COHORT preserves actual dashboard/frontend material and rebuild-grade architecture/contracts alongside a disconnected synthetic adapter. Original task/node/review renderers are reused; the public demo offers fixture-driven layers, research/decisions inspection, drilldowns, in-memory status/owner simulation and reset, and deadline/health-state exploration. It includes no coordinator backend, live agents, API calls, credentials, or persistent changes. Azure Local's capstone is an interactive architecture walkthrough, not a management console. ANS-CHOCO presents the delivered policy-driven application-alignment workflow: catalog/inventory preparation, modular package build/deploy, WinRM reconciliation, operational policy, and reporting evidence. Detailed setup and execution boundaries remain in the technical project repository.

All three hosted showcases are independent static or synthetic experiences. ANS-CHOCO's catalogs and policy, inventories, package sources, and authentication are configurable rather than tied to one lab; execution currently uses Ansible and WinRM. As deployment scale, business scope, and security requirements evolve, future enhancement options include Azure Arc execution through official modules and client-based authentication, with the aim of reducing reliance on WinRM. The existing optional Arc sample requires user-provided cloud setup and an external pull script; it is separate from these future enhancement options. Actual Azure Local provisioning requires user-provided tenant/subscription, permissions, prepared hardware, directory services, networking, and credentials. None of those operational dependencies is needed to view the hosted showcases. Azure Local's retained records describe a functional four-node lab POC, not production certification or a newly connected cloud session.

## Project visuals

The ANS-CHOCO architecture overview is at `site/assets/ans-choco-architecture.png`. Its homepage caption and project details explain the delivered workflow and engineering decisions while keeping the static-presentation context explicit.

The representative COHORT research/decisions screenshot is at `site/assets/cohort-governance.png`. Its figure and profile alt text explicitly say OFFLINE / SYNTHETIC and make no production-count or outcome claims. The earlier `site/assets/cohort-tasks.png` remains available for existing links, not as a second figure. The project story reflects tooling built to organize David's own projects and tasks, not enterprise adoption or complete feature parity with Copilot.

The Azure Local platform screenshot is at `site/assets/azure-local-architecture.png`. It depicts a static capstone state explaining recorded lab work, not a connected Azure session or newly executed test.

The image files are unchanged copies of their corresponding public project captures. Each of the three homepage figures has meaningful alt text, explicit dimensions, responsive sizing, and an adjacent scope caption. The profile references these same personal Pages assets instead of duplicating binaries.

Each homepage figure offers an explicit full-resolution image link. Profile images also link to their full-resolution assets. The screenshot's tiny interface text is not a substitute for the readable project explanation and implementation boundaries.

## Guided Azure viewing

On the canonical hosted portfolio, the Azure action and preview open an in-place native-dialog lightbox over the dimmed page. The child route `https://djaykurtz.github.io/AZLOCAL-POC/viewer/?embed=1` owns presentation instructions; the host provides an obvious Exit view and separate Full view fallback. Loading is reported visibly until the actual presentation controls are ready; missing or slow content shows a direct-view fallback rather than leaving an unexplained empty frame. Closing restores the triggering link and the previous portfolio scroll position. The embedded frame is removed on exit and restarts on the next open.

Host Escape forwards the fixed escape message so the child closes BUILT evidence first, then requests exit. Exit messages are accepted only from the active iframe at the same origin and with the exact allowed payload. Visibility messages contain only a typed boolean; no arbitrary commands, wildcard origins, or evaluation are used.

Without JavaScript or native dialog support, or from a file/noncanonical HTTP preview, the links open `https://djaykurtz.github.io/AZLOCAL-POC/viewer/` directly. The original standalone/presenter route remains linked in project details and the profile. The lightbox has no decorative border or scaling of text; its short opacity entrance is disabled for reduced motion.

The separate profile candidate is in the sibling `djaykurtz` folder. Its root `README.md` belongs in `djaykurtz/djaykurtz`; it requires no workflow.

No license has been selected or added.
