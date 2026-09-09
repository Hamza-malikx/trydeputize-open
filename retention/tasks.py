import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from .models import Job

logger = logging.getLogger(__name__)

# Cache key the heartbeat writes and /healthz/worker/ reads. In prod both
# processes share the Redis cache, so the web container can vouch for the
# worker. The TTL means a dead worker's last beat disappears on its own.
WORKER_HEARTBEAT_KEY = "worker-heartbeat"
WORKER_HEARTBEAT_TTL_SECONDS = 15 * 60


@shared_task
def worker_heartbeat():
    """Prove the worker + broker path is alive.

    Beat enqueues this every minute; a worker executing it writes the current
    time to the shared cache. If the timestamp goes stale, jobs would be
    sitting in the queue unprocessed: exactly the failure the OCR launch week
    hit with a dead broker connection, and the reason uptime monitoring
    watches this and not just the web process.
    """
    cache.set(WORKER_HEARTBEAT_KEY, timezone.now().isoformat(), WORKER_HEARTBEAT_TTL_SECONDS)


@shared_task
def cleanup_expired_jobs():
    """Delete jobs (rows + files) older than the retention window.

    Runs every 10 minutes via beat. This is the mechanism behind the privacy
    page's promise that uploads and results are deleted automatically about an
    hour after a job is created, whatever its status ended up being.
    """
    now = timezone.now()
    cutoff = now - timedelta(minutes=settings.TOOLS_JOB_RETENTION_MINUTES)
    stale_transcription_cutoff = now - timedelta(
        seconds=settings.VIDEO_TRANSCRIPTION_ACTIVE_RETENTION_SECONDS
    )
    active_transcription = Q(
        tool="video-to-text",
        status__in=(Job.Status.PENDING, Job.Status.PROCESSING),
    )
    expired = Q(created_at__lt=cutoff) & ~active_transcription
    stale_active_transcription = active_transcription & Q(created_at__lt=stale_transcription_cutoff)
    deleted = 0
    for job in Job.objects.filter(expired | stale_active_transcription):
        job.delete_files()
        job.delete()
        deleted += 1
    if deleted:
        logger.info("cleanup_expired_jobs removed %d job(s)", deleted)
    return deleted
