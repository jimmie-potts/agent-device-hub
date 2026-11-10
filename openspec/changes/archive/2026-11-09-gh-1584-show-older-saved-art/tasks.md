## 1. Core

- [x] 1.1 Add the host-bound catalog reader and the show's fallback past the published record. `apps/runtime/tests/art-show.test.ts` shows on the real runtime that retained older art on the catalog's second page prepares and presents its exact compositions by the same plan, and that art in the record reads no catalog.
- [x] 1.2 Refuse art that is not retained with `not-found`, and a refused, malformed or non-advancing catalog with `unavailable`, sending nothing and freeing the show slot. The same test file covers these cases.

## 2. Consumers

- [x] 2.1 Enable the gallery's Show now for every listed artwork. The Art browser check shows an artwork pushed past the 24 most recent, shown from a later gallery page in Linux.
- [x] 2.2 State in `core_art_show`'s description that any retained artwork can be shown. The tool still sends the same command through the dispatcher.

## 3. Records

- [x] 3.1 Update the runtime and art guides, validate this change strictly, synchronize `bunny-runtime` and `bunny-art`, and archive the change on the delivery branch before final review.
