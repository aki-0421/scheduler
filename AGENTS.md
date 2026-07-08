# AGENTS.md

## Language

* The default language for everything must be English.

## Documentation

Read the product policy in [PRODUCT.md](PRODUCT.md).
Navigate the repository documentation starting from [docs/](docs/).

Find repository management documentation with `agent-docs list docs`, and review the necessary documents with `agent-docs read <file>`.
Use `agent-docs read <file> --body` only when the document body is needed.

Before starting implementation, document the specification in writing.

## Work Products

Use `agent-browser` for UI and behavior verification.
Save verification screenshots created with `agent-browser` in `/tmp` or in an ignored `tmp/` directory within the repository, and do not include them in commits.
