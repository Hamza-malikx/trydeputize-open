"""The retention sweep's tests, extracted from the backend suite.

Run inside the backend repository with pytest; they are here so the behaviour
described in the README can be read rather than taken on trust.
"""
from datetime import timedelta
from pathlib import Path

import pytest
from django.core.files.base import ContentFile
from django.utils import timezone

from .models import Job
from .tasks import cleanup_expired_jobs

def test_cleanup_removes_expired_and_spares_fresh(settings):
    expired = Job.objects.create(tool="merge-pdf")
    expired.output.save("merged.pdf", ContentFile(b"%PDF-fake"), save=True)
    fresh = Job.objects.create(tool="merge-pdf")
    fresh.output.save("merged.pdf", ContentFile(b"%PDF-fake"), save=True)
    # A job whose files are already gone must still be deletable.
    bare = Job.objects.create(tool="merge-pdf")

    old = timezone.now() - timedelta(minutes=settings.TOOLS_JOB_RETENTION_MINUTES + 1)
    Job.objects.filter(pk__in=[expired.pk, bare.pk]).update(created_at=old)

    assert cleanup_expired_jobs() == 2

    assert set(Job.objects.values_list("pk", flat=True)) == {fresh.pk}
    jobs_root = settings.MEDIA_ROOT / "jobs"
    assert not (jobs_root / str(expired.pk)).exists()
    assert (jobs_root / str(fresh.pk)).exists()


def test_cleanup_protects_active_transcription_until_stale(settings):
    pending = Job.objects.create(tool="video-to-text")
    stale = Job.objects.create(tool="video-to-text", status=Job.Status.PROCESSING)
    two_hours_ago = timezone.now() - timedelta(hours=2)
    thirteen_hours_ago = timezone.now() - timedelta(hours=13)
    Job.objects.filter(pk=pending.pk).update(created_at=two_hours_ago)
    Job.objects.filter(pk=stale.pk).update(created_at=thirteen_hours_ago)

    assert cleanup_expired_jobs() == 1
    assert Job.objects.filter(pk=pending.pk).exists()
    assert not Job.objects.filter(pk=stale.pk).exists()
