import { useState } from "react";
import { useIntl } from "react-intl";

import { getJobStatus } from "components/JobItem/JobItem";
import { Button } from "components/ui/Button";
import { Text } from "components/ui/Text";

import { AttemptRead, SynchronousJobRead } from "core/request/AirbyteClient";
import Status from "core/statuses";
import { JobsWithJobs } from "pages/ConnectionPage/pages/ConnectionItemPage/JobsList";
import { formatBytes } from "utils/numberHelper";

import styles from "./JobProgress.module.scss";
import { ProgressLine } from "./JobProgressLine";

function isJobsWithJobs(job: JobsWithJobs | SynchronousJobRead): job is JobsWithJobs {
  return "attempts" in job;
}

interface ProgressBarProps {
  job: JobsWithJobs | SynchronousJobRead;
}

export const JobProgress: React.FC<ProgressBarProps> = ({ job }) => {
  const { formatMessage, formatNumber } = useIntl();
  const [showStreams, setShowStreams] = useState(false);

  let latestAttempt: AttemptRead | undefined;
  if (isJobsWithJobs(job) && job.attempts) {
    latestAttempt = job.attempts[job.attempts.length - 1];
  }
  if (!latestAttempt) {
    return null;
  }

  const jobStatus = getJobStatus(job);
  if (["failed", "succeeded", "cancelled"].includes(jobStatus)) {
    return null;
  }
  const color = styles[jobStatus] ?? "white";
  const {
    displayProgressBar,
    totalPercentRecords,
    timeRemaining,
    numeratorBytes,
    numeratorRecords,
    denominatorRecords,
    denominatorBytes,
    unEstimatedStreams,
    elapsedTimeMS,
  } = progressBarCalculations(latestAttempt);

  let timeRemainingString = "";
  if (elapsedTimeMS && timeRemaining) {
    const minutesRemaining = Math.ceil(timeRemaining / 1000 / 60);
    const hoursRemaining = Math.ceil(minutesRemaining / 60);
    if (minutesRemaining <= 60) {
      timeRemainingString = formatMessage({ id: "estimate.minutesRemaining" }, { value: minutesRemaining });
    } else {
      timeRemainingString = formatMessage({ id: "estimate.hoursRemaining" }, { value: hoursRemaining });
    }
  }

  return (
    <Text as="div" size="xs">
      {displayProgressBar && <ProgressLine percent={totalPercentRecords} color={color} />}
      {latestAttempt?.status === Status.RUNNING && (
        <>
          {displayProgressBar && (
            <div>
              {totalPercentRecords}% {timeRemaining < Infinity && timeRemaining > 0 ? `| ~${timeRemainingString}` : ""}
            </div>
          )}
          {!displayProgressBar && unEstimatedStreams.length > 0 && (
            <div>
              {unEstimatedStreams.length} {formatMessage({ id: "estimate.unEstimatedStreams" })}
            </div>
          )}
          {denominatorRecords > 0 && (
            <>
              <div>
                {formatNumber(numeratorRecords)} {displayProgressBar ? "" : `/ ${formatNumber(denominatorRecords)}`}{" "}
                {formatMessage({ id: "estimate.recordsSynced" }, { value: numeratorRecords })} @{" "}
                {Math.round((numeratorRecords / elapsedTimeMS) * 1000)}{" "}
                {formatMessage({ id: "estimate.recordsPerSecond" })}
              </div>
              <div>
                {formatBytes(numeratorBytes)}{" "}
                {displayProgressBar && (
                  <>
                    <span>/ </span>
                    {formatBytes(denominatorBytes)}
                  </>
                )}{" "}
                {formatMessage({ id: "estimate.bytesSynced" })} @ {formatBytes((numeratorBytes * 1000) / elapsedTimeMS)}
                {formatMessage({ id: "estimate.perSecond" })}
              </div>
            </>
          )}

          {latestAttempt.streamStats && !showStreams && (
            <div>
              <Button
                variant="clear"
                style={{ padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStreams(true);
                }}
              >
                <p>
                  {formatMessage({
                    id: "estimate.viewStreamStats",
                  })}
                </p>
              </Button>
              <br />
            </div>
          )}

          {latestAttempt.streamStats && showStreams && (
            <div>
              <Text as="div" size="xs">
                {formatMessage({
                  id: "estimate.streamStats",
                })}{" "}
                (
                <Button
                  variant="clear"
                  style={{ padding: 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowStreams(false);
                  }}
                >
                  <p>
                    {formatMessage({
                      id: "estimate.hide",
                    })}
                  </p>
                </Button>
                ):
              </Text>
              {latestAttempt.streamStats?.map((stream, idx) => {
                const localNumerator = stream.stats.recordsEmitted;
                const localDenominator = stream.stats.estimatedRecords;

                return (
                  <Text size="xs" as="div" key={`stream-progress-${idx}`}>
                    {" - "}
                    <strong>{stream.streamName}</strong> -{" "}
                    {localNumerator && localDenominator
                      ? `${Math.round((localNumerator * 100) / localDenominator)}${formatMessage({
                          id: "estimate.percentComplete",
                        })} (${formatNumber(localNumerator)} / ${formatNumber(localDenominator)} ${formatMessage(
                          { id: "estimate.recordsSynced" },
                          { value: localNumerator }
                        )})`
                      : `${localNumerator} ${formatMessage(
                          { id: "estimate.recordsSynced" },
                          { value: localNumerator }
                        )} (${formatMessage({
                          id: "estimate.noEstimate",
                        })})`}
                  </Text>
                );
              })}
            </div>
          )}
        </>
      )}
    </Text>
  );
};

export const progressBarCalculations = (latestAttempt: AttemptRead) => {
  let numeratorRecords = -1;
  let denominatorRecords = -1;
  let totalPercentRecords = -1;
  let numeratorBytes = -1;
  let denominatorBytes = -1;
  let elapsedTimeMS = -1;
  let timeRemaining = -1;
  const unEstimatedStreams: string[] = [];
  let displayProgressBar = true;

  let countTotalsFromStreams = true;
  if (
    latestAttempt.totalStats?.recordsEmitted &&
    latestAttempt.totalStats?.estimatedRecords &&
    latestAttempt.totalStats?.bytesEmitted &&
    latestAttempt.totalStats?.estimatedBytes
  ) {
    countTotalsFromStreams = false;
    numeratorRecords = latestAttempt.totalStats.recordsEmitted;
    denominatorRecords = latestAttempt.totalStats.estimatedRecords;
    numeratorBytes = latestAttempt.totalStats.bytesEmitted;
    denominatorBytes = latestAttempt.totalStats.estimatedBytes;
  } else if (!latestAttempt.totalStats && latestAttempt.streamStats) {
    for (const stream of latestAttempt.streamStats) {
      if (countTotalsFromStreams) {
        numeratorRecords += stream.stats.recordsEmitted ?? 0;
        denominatorRecords += stream.stats.estimatedRecords ?? 0;
        numeratorBytes += stream.stats.bytesEmitted ?? 0;
        denominatorBytes += stream.stats.estimatedBytes ?? 0;
      }
    }
  }

  if (latestAttempt.streamStats) {
    for (const stream of latestAttempt.streamStats) {
      if (!stream.stats.recordsEmitted) {
        unEstimatedStreams.push(`${stream.streamName}`);
      }
    }
  }

  totalPercentRecords = denominatorRecords > 0 ? Math.floor((numeratorRecords * 100) / denominatorRecords) : 0;

  // chose to estimate time remaining based on records rather than bytes
  if (latestAttempt.status === Status.RUNNING && denominatorRecords > 0) {
    elapsedTimeMS = Date.now() - latestAttempt.createdAt * 1000;
    timeRemaining = Math.floor(elapsedTimeMS / totalPercentRecords) * (100 - totalPercentRecords); // in ms
  } else {
    displayProgressBar = false;
  }

  return {
    displayProgressBar,
    totalPercentRecords,
    timeRemaining,
    numeratorBytes,
    numeratorRecords,
    denominatorRecords,
    denominatorBytes,
    unEstimatedStreams,
    elapsedTimeMS,
  };
};
