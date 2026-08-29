import path from "path";
import { DATA_DIR, readJsonIfExists, resolveR2Config, resolveSyncTarget } from "./config.mjs";
import { FeishuBitableApiClient, getTenantAccessToken } from "./feishu-api.mjs";
import { loadOrFetchPromptPayload } from "./prompt-source.mjs";
import { analyzePromptForSite } from "./prompt-insights.mjs";
import {
  buildSiteVideoFields,
  normalizePromptToRow,
  promptToSitePrompt,
  rowObjectToSitePrompt
} from "./prompt-utils.mjs";
import { getMirrorRecord, loadMirrorManifest } from "./video-source.mjs";

function getSnapshotPath(locale) {
  return path.join(DATA_DIR, `prompts.${locale}.json`);
}

function isSnapshotPayload(payload, { locale, model }) {
  return (
    payload &&
    payload.locale === locale &&
    payload.model === model &&
    Array.isArray(payload.prompts)
  );
}

function sanitizeSitePrompt(prompt) {
  return {
    id: prompt.id,
    title: prompt.title || "",
    description: prompt.description || "",
    prompt: prompt.prompt || "",
    translatedPrompt: prompt.translatedPrompt || "",
    language: prompt.language || "",
    featured: Boolean(prompt.featured),
    sourceLink: prompt.sourceLink || "",
    sourcePublishedAt: prompt.sourcePublishedAt || "",
    authorName: prompt.authorName || "",
    authorLink: prompt.authorLink || "",
    detailUrl: prompt.detailUrl || "",
    videoUrl: prompt.videoUrl || "",
    originalVideoUrl: prompt.originalVideoUrl || "",
    mirrorVideoUrl: prompt.mirrorVideoUrl || "",
    playbackUrl: prompt.playbackUrl || prompt.mirrorVideoUrl || prompt.originalVideoUrl || "",
    videoEmbedUrl: prompt.videoEmbedUrl || "",
    thumbnailUrl: prompt.thumbnailUrl || "",
    referenceImages: Array.isArray(prompt.referenceImages) ? prompt.referenceImages : [],
    mirrorStatus: prompt.mirrorStatus || "",
    mirrorSyncedAt: prompt.mirrorSyncedAt || "",
    analysis: analyzePromptForSite(prompt)
  };
}

function mergePromptWithMirrorRecord(prompt, mirrorRecord) {
  if (!mirrorRecord) {
    return prompt;
  }

  return {
    ...prompt,
    ...buildSiteVideoFields({
      streamVideoUrl: prompt.videoUrl,
      originalVideoUrl: mirrorRecord.originalVideoUrl || prompt.originalVideoUrl,
      mirrorVideoUrl: mirrorRecord.mirrorVideoUrl || prompt.mirrorVideoUrl
    }),
    mirrorStatus: mirrorRecord.status || prompt.mirrorStatus || "",
    mirrorSyncedAt: mirrorRecord.syncedAt || prompt.mirrorSyncedAt || ""
  };
}

function getLatestIso(values) {
  const timestamps = values
    .map((value) => Date.parse(value || ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);

  if (timestamps.length === 0) {
    return new Date().toISOString();
  }

  return new Date(timestamps[0]).toISOString();
}

function buildSitePayload({
  prompts,
  locale,
  model,
  generatedAt,
  dataSource,
  dataSourceLabel,
  fallbackReason = "",
  validation = null
}) {
  return {
    generatedAt,
    locale,
    model,
    total: prompts.length,
    dataSource,
    dataSourceLabel,
    fallbackReason,
    validation,
    prompts: prompts.map(sanitizeSitePrompt)
  };
}

async function loadSnapshotPayload(target) {
  const snapshotPath = getSnapshotPath(target.locale);
  const localSnapshot = readJsonIfExists(snapshotPath);

  if (isSnapshotPayload(localSnapshot, target)) {
    return {
      payload: localSnapshot,
      snapshotPath,
      source: "local-file"
    };
  }

  const loaded = await loadOrFetchPromptPayload({
    locale: target.locale,
    model: target.model,
    forceRefresh: process.env.YOUMIND_FORCE_REFRESH === "1",
    preferCache: true,
    allowStaleFallbackOnError: true
  });

  return {
    payload: loaded.payload,
    snapshotPath: loaded.cachePath,
    source: loaded.source
  };
}

async function listAllRowsFromFeishu(baseToken, tableId) {
  const token = await getTenantAccessToken();
  const client = new FeishuBitableApiClient(token);
  const rows = [];
  let pageToken = "";

  while (true) {
    const data = await client.listRecords({ baseToken, tableId, pageToken });

    for (const record of data.items || []) {
      const fields = record.fields || {};

      if (!fields["Prompt ID"]) {
        continue;
      }

      rows.push(fields);
    }

    if (!data.has_more || !data.page_token) {
      break;
    }

    pageToken = data.page_token;
  }

  return rows;
}

function validateFeishuPromptsAgainstSnapshot(feishuPrompts, snapshotPayload, target) {
  if (!snapshotPayload) {
    return {
      checked: false,
      ok: true,
      expectedCount: 0,
      actualCount: feishuPrompts.length,
      duplicateIds: [],
      missingIds: [],
      changedIds: [],
      extraIds: []
    };
  }

  const expected = new Map(
    snapshotPayload.prompts.map((prompt) => {
      const row = normalizePromptToRow(prompt, {
        locale: target.locale,
        model: target.model,
        syncedAt: snapshotPayload.fetchedAt,
        active: true
      });

      return [row["Prompt ID"], row["Content Hash"]];
    })
  );

  const actual = new Map();
  const duplicateIds = [];

  for (const prompt of feishuPrompts) {
    const promptId = String(prompt.id);

    if (actual.has(promptId)) {
      duplicateIds.push(promptId);
    }

    actual.set(promptId, prompt.contentHash || "");
  }

  const missingIds = [];
  const changedIds = [];
  const extraIds = [];

  for (const [promptId, expectedHash] of expected.entries()) {
    if (!actual.has(promptId)) {
      missingIds.push(promptId);
      continue;
    }

    if (actual.get(promptId) !== expectedHash) {
      changedIds.push(promptId);
    }
  }

  for (const promptId of actual.keys()) {
    if (!expected.has(promptId)) {
      extraIds.push(promptId);
    }
  }

  return {
    checked: true,
    ok:
      duplicateIds.length === 0 &&
      missingIds.length === 0 &&
      changedIds.length === 0 &&
      extraIds.length === 0,
    expectedCount: expected.size,
    actualCount: actual.size,
    duplicateIds: duplicateIds.slice(0, 5),
    missingIds: missingIds.slice(0, 5),
    changedIds: changedIds.slice(0, 5),
    extraIds: extraIds.slice(0, 5)
  };
}

function formatValidationIssue(validation) {
  return [
    `expected=${validation.expectedCount}`,
    `actual=${validation.actualCount}`,
    validation.duplicateIds.length > 0 ? `duplicates=${validation.duplicateIds.join(",")}` : "",
    validation.missingIds.length > 0 ? `missing=${validation.missingIds.join(",")}` : "",
    validation.changedIds.length > 0 ? `changed=${validation.changedIds.join(",")}` : "",
    validation.extraIds.length > 0 ? `extra=${validation.extraIds.join(",")}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return message.replace(/\s+/g, " ").trim().slice(0, 320);
}

function buildPayloadFromSnapshot(snapshotPayload, target, mirrorManifest, fallbackReason = "") {
  const prompts = snapshotPayload.prompts.map((prompt) => {
    const sitePrompt = promptToSitePrompt(prompt, { locale: target.locale });

    return mergePromptWithMirrorRecord(
      sitePrompt,
      getMirrorRecord(mirrorManifest, prompt.id, sitePrompt.originalVideoUrl)
    );
  });

  return buildSitePayload({
    prompts,
    locale: target.locale,
    model: target.model,
    generatedAt: snapshotPayload.fetchedAt || new Date().toISOString(),
    dataSource: fallbackReason ? "youmind-fallback" : "youmind",
    dataSourceLabel: fallbackReason ? "Public Snapshot Fallback" : "Public Snapshot",
    fallbackReason
  });
}

export async function loadSitePayloadForBuild() {
  const target = resolveSyncTarget({ requireBase: false });
  const mirrorManifest = loadMirrorManifest(resolveR2Config().manifestPath);
  const siteSourceMode = process.env.SITE_SOURCE_MODE || "auto";
  const snapshotResult = await loadSnapshotPayload(target);
  const snapshotPayload = snapshotResult.payload;
  const shouldTryFeishu =
    siteSourceMode !== "public-only" && Boolean(target.baseToken) && Boolean(target.tableId);

  if (shouldTryFeishu) {
    try {
      const rows = await listAllRowsFromFeishu(target.baseToken, target.tableId);
      const prompts = rows
        .map((row) =>
          mergePromptWithMirrorRecord(
            rowObjectToSitePrompt(row),
            getMirrorRecord(mirrorManifest, row["Prompt ID"], row["Original Video URL"])
          )
        )
        .filter((prompt) => prompt.active !== false)
        .filter((prompt) => !prompt.model || prompt.model === target.model);
      const validation = validateFeishuPromptsAgainstSnapshot(prompts, snapshotPayload, target);

      if (!validation.ok) {
        throw new Error(`Feishu validation failed: ${formatValidationIssue(validation)}`);
      }

      return {
        source: "feishu",
        payload: buildSitePayload({
          prompts,
          locale: target.locale,
          model: target.model,
          generatedAt: getLatestIso([
            ...prompts.map((prompt) => prompt.syncedAt),
            snapshotPayload?.fetchedAt
          ]),
          dataSource: "feishu",
          dataSourceLabel: "Feishu Mirror",
          validation
        })
      };
    } catch (error) {
      if (siteSourceMode === "feishu-only") {
        throw error;
      }

      const fallbackReason = summarizeErrorMessage(error);

      return {
        source: "youmind-fallback",
        payload: buildPayloadFromSnapshot(snapshotPayload, target, mirrorManifest, fallbackReason)
      };
    }
  }

  return {
    source: "youmind",
    payload: buildPayloadFromSnapshot(snapshotPayload, target, mirrorManifest)
  };
}
