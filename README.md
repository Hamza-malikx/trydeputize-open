# TryDeputize, in the open

Two pieces of [TryDeputize](https://www.trydeputize.com), a set of 41 free file
tools, published because they are the two things people ask me to prove.

MIT licensed. Take any of it.

## `retention/`, the code that deletes your file

Every free file tool says uploads are deleted. This is the task that does it,
copied from the running backend rather than written for this repository.

A Celery beat task runs every 10 minutes. It selects jobs older than the
retention window (60 minutes in production), deletes the stored files and the
database row for each, and logs the count.

```python
expired = Q(created_at__lt=cutoff) & ~active_transcription
```

There is one exception, and it is in the code rather than in a footnote: a
transcription that is still queued or running is spared, so a slow job is not
deleted out from under itself while it is being worked on. That protection has
its own ceiling of 12 hours, so a stopped worker cannot keep files forever.

`retention/tasks.py` is the module as it runs. `retention/test_cleanup.py` is
its test: create an expired job with a file, run the sweep, assert the row and
the directory are gone.

**What this is not:** the whole backend. That repository is private. This is
the retention path lifted out of it, unedited, so the claim on the site can be
read instead of believed.

## `barcode/`, a barcode encoder's rules

The validation half of the site's [barcode
generator](https://www.trydeputize.com/tools/barcode-generator), with no
dependencies and no browser: eight symbologies (Code 128, Code 39, EAN-13,
EAN-8, UPC-A, UPC-E, ITF-14, Codabar), GS1 check digits computed and verified,
UPC-E expansion to UPC-A, and the batch sheet composer.

It is here because the interesting part of a barcode tool is not the drawing,
which a library does, but knowing what a given symbology will accept and being
able to say why it will not:

```ts
symbologyById("ean13").prepare("400638133393")
// { ok: true, value: "4006381333931", note: "Check digit 1 added." }

symbologyById("ean13").prepare("4006381333935")
// { ok: false, message: "The check digit does not match: for 400638133393 it is 1, not 5. ..." }
```

Encoding itself is [JsBarcode](https://github.com/lindell/JsBarcode); this is
everything around it. `barcode/barcode-model.test.ts` runs on `node --test`
with no build step, and its expectations are published GS1 examples.

## The site

41 free tools: PDF merge, split, compress, edit, OCR, protect, convert; image
compress, resize, crop, format conversion; video transcription and subtitles;
and small utilities. No account, no watermark, no credit system. Nine of the
tools run entirely in the browser and upload nothing at all.

<https://www.trydeputize.com>
