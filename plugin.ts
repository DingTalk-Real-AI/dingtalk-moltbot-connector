/**
 * DingTalk Channel Plugin for Moltbot
 *
 * 通过钉钉 Stream 模式连接，支持 AI Card 流式响应。
 * 完整接入 Moltbot 消息处理管道。
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import axios from 'axios';
import type { ClawdbotPluginApi, PluginRuntime, ClawdbotConfig } from 'clawdbot/plugin-sdk';

// ============ 常量 ============

export const id = 'dingtalk-connector';

let runtime: PluginRuntime | null = null;

function getRuntime(): PluginRuntime {
  if (!runtime) throw new Error('DingTalk runtime not initialized');
  return runtime;
}

// ============ Session 管理 ============

/** 用户会话状态：记录最后活跃时间和当前 session 标识 */
interface UserSession {
  lastActivity: number;
  sessionId: string;  // 格式: dingtalk-connector:<senderId> 或 dingtalk-connector:<senderId>:<timestamp>
}

/** 用户会话缓存 Map<senderId, UserSession> */
const userSessions = new Map<string, UserSession>();

/** 新会话触发命令 */
const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/** 检查消息是否是新会话命令 */
function isNewSessionCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NEW_SESSION_COMMANDS.some(cmd => trimmed === cmd.toLowerCase());
}

/** 获取或创建用户 session key */
function getSessionKey(
  senderId: string,
  forceNew: boolean,
  sessionTimeout: number,
  log?: any,
): { sessionKey: string; isNew: boolean } {
  const now = Date.now();
  const existing = userSessions.get(senderId);

  // 强制新会话
  if (forceNew) {
    const sessionId = `dingtalk-connector:${senderId}:${now}`;
    userSessions.set(senderId, { lastActivity: now, sessionId });
    log?.info?.(`[DingTalk][Session] 用户主动开启新会话: ${senderId}`);
    return { sessionKey: sessionId, isNew: true };
  }

  // 检查超时
  if (existing) {
    const elapsed = now - existing.lastActivity;
    if (elapsed > sessionTimeout) {
      const sessionId = `dingtalk-connector:${senderId}:${now}`;
      userSessions.set(senderId, { lastActivity: now, sessionId });
      log?.info?.(`[DingTalk][Session] 会话超时(${Math.round(elapsed / 60000)}分钟)，自动开启新会话: ${senderId}`);
      return { sessionKey: sessionId, isNew: true };
    }
    // 更新活跃时间
    existing.lastActivity = now;
    return { sessionKey: existing.sessionId, isNew: false };
  }

  // 首次会话
  const sessionId = `dingtalk-connector:${senderId}`;
  userSessions.set(senderId, { lastActivity: now, sessionId });
  log?.info?.(`[DingTalk][Session] 新用户首次会话: ${senderId}`);
  return { sessionKey: sessionId, isNew: false };
}

// ============ Access Token 缓存 ============

let accessToken: string | null = null;
let accessTokenExpiry = 0;

async function getAccessToken(config: any): Promise<string> {
  const now = Date.now();
  if (accessToken && accessTokenExpiry > now + 60_000) {
    return accessToken;
  }

  const response = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  accessToken = response.data.accessToken;
  accessTokenExpiry = now + (response.data.expireIn * 1000);
  return accessToken!;
}

// ============ 配置工具 ============

function getConfig(cfg: ClawdbotConfig) {
  return (cfg?.channels as any)?.['dingtalk-connector'] || {};
}

function isConfigured(cfg: ClawdbotConfig): boolean {
  const config = getConfig(cfg);
  return Boolean(config.clientId && config.clientSecret);
}

// ============ 钉钉图片上传 ============

async function getOapiAccessToken(config: any): Promise<string | null> {
  try {
    const resp = await axios.get('https://oapi.dingtalk.com/gettoken', {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0) return resp.data.access_token;
    return null;
  } catch {
    return null;
  }
}

function buildMediaSystemPrompt(): string {
  return `## 钉钉图片和文件显示规则

你正在钉钉中与用户对话。

### 一、图片显示

显示图片时，直接使用本地文件路径，系统会自动上传处理。

**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**

直接输出本地路径即可，系统会自动上传到钉钉。

### 二、文件分享

**何时分享文件**：
- ✅ 用户明确要求**分享、发送、上传**文件时
- ❌ 仅生成文件保存到本地时，**不需要**分享

**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：

\`\`\`
[DINGTALK_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/DINGTALK_FILE]
\`\`\`

**支持的文件类型**：几乎所有常见格式

**重要**：文件大小不得超过 20MB，超过限制时告知用户文件过大。

### 三、视频分享

**何时分享视频**：
- ✅ 用户明确要求**分享、发送、上传**视频时
- ❌ 仅生成视频保存到本地时，**不需要**分享

**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_VIDEO]{"path":"<本地视频路径>"}[/DINGTALK_VIDEO]
\`\`\`

**支持格式**：mp4（最大 20MB）

**重要**：
- 视频大小不得超过 20MB，超过限制时告知用户
- 仅支持 mp4 格式
- 系统会自动提取视频时长、分辨率并生成封面`;
}

// ============ 图片后处理：自动上传本地图片到钉钉 ============

/**
 * 匹配 markdown 图片中的本地文件路径（跨平台）：
 * - ![alt](file:///path/to/image.jpg)
 * - ![alt](MEDIA:/var/folders/xxx.jpg)
 * - ![alt](attachment:///path.jpg)
 * macOS:
 * - ![alt](/tmp/xxx.jpg)
 * - ![alt](/var/folders/xxx.jpg)
 * - ![alt](/Users/xxx/photo.jpg)
 * Linux:
 * - ![alt](/home/user/photo.jpg)
 * - ![alt](/root/photo.jpg)
 * Windows:
 * - ![alt](C:\Users\xxx\photo.jpg)
 * - ![alt](C:/Users/xxx/photo.jpg)
 */
const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^)]+|\/(?:tmp|var|private|Users|home|root)[^)]+|[A-Za-z]:[\\/ ][^)]+)\)/g;

/** 图片文件扩展名 */
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i;

/**
 * 匹配纯文本中的本地图片路径（不在 markdown 图片语法中，跨平台）：
 * macOS:
 * - `/var/folders/.../screenshot.png`
 * - `/tmp/image.jpg`
 * - `/Users/xxx/photo.png`
 * Linux:
 * - `/home/user/photo.png`
 * - `/root/photo.png`
 * Windows:
 * - `C:\Users\xxx\photo.png`
 * - `C:/temp/image.jpg`
 * 支持 backtick 包裹: `path`
 */
const BARE_IMAGE_PATH_RE = /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;

/** 去掉 file:// / MEDIA: / attachment:// 前缀，得到实际的绝对路径 */
function toLocalPath(raw: string): string {
  let path = raw;
  if (path.startsWith('file://')) path = path.replace('file://', '');
  else if (path.startsWith('MEDIA:')) path = path.replace('MEDIA:', '');
  else if (path.startsWith('attachment://')) path = path.replace('attachment://', '');

  // 解码 URL 编码的路径（如中文字符 %E5%9B%BE → 图）
  try {
    path = decodeURIComponent(path);
  } catch {
    // 解码失败则保持原样
  }
  return path;
}

/**
 * 通用媒体文件上传函数
 * @param filePath 文件路径
 * @param mediaType 媒体类型：image, file, video, voice
 * @param oapiToken 钉钉 access_token
 * @param maxSize 最大文件大小（字节），默认 20MB
 * @param log 日志对象
 * @returns media_id 或 null
 */
async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: 'image' | 'file' | 'video' | 'voice',
  oapiToken: string,
  maxSize: number = 20 * 1024 * 1024,
  log?: any,
): Promise<string | null> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const FormData = (await import('form-data')).default;

    const absPath = toLocalPath(filePath);
    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][${mediaType}] 文件不存在: ${absPath}`);
      return null;
    }

    // 检查文件大小
    const stats = fs.statSync(absPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    if (stats.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      log?.warn?.(`[DingTalk][${mediaType}] 文件过大: ${absPath}, 大小: ${fileSizeMB}MB, 超过限制 ${maxSizeMB}MB`);
      return null;
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream',
    });

    log?.info?.(`[DingTalk][${mediaType}] 上传文件: ${absPath} (${fileSizeMB}MB)`);
    const resp = await axios.post(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=${mediaType}`,
      form,
      { headers: form.getHeaders(), timeout: 60_000 },
    );

    const mediaId = resp.data?.media_id;
    if (mediaId) {
      log?.info?.(`[DingTalk][${mediaType}] 上传成功: media_id=${mediaId}`);
      return mediaId;
    }
    log?.warn?.(`[DingTalk][${mediaType}] 上传返回无 media_id: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[DingTalk][${mediaType}] 上传失败: ${err.message}`);
    return null;
  }
}

/** 扫描内容中的本地图片路径，上传到钉钉并替换为 media_id */
async function processLocalImages(
  content: string,
  oapiToken: string | null,
  log?: any,
): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][Media] 无 oapiToken，跳过图片后处理`);
    return content;
  }

  let result = content;

  // 第一步：匹配 markdown 图片语法 ![alt](path)
  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  if (mdMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] 检测到 ${mdMatches.length} 个 markdown 图片，开始上传...`);
    for (const match of mdMatches) {
      const [fullMatch, alt, rawPath] = match;
      // 清理转义字符（AI 可能会对含空格的路径添加 \ ）
      const cleanPath = rawPath.replace(/\\ /g, ' ');
      const mediaId = await uploadMediaToDingTalk(cleanPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (mediaId) {
        result = result.replace(fullMatch, `![${alt}](${mediaId})`);
      }
    }
  }

  // 第二步：匹配纯文本中的本地图片路径（如 `/var/folders/.../xxx.png`）
  // 排除已被 markdown 图片语法包裹的路径
  const bareMatches = [...result.matchAll(BARE_IMAGE_PATH_RE)];
  const newBareMatches = bareMatches.filter(m => {
    // 检查这个路径是否已经在 ![...](...) 中
    const idx = m.index!;
    const before = result.slice(Math.max(0, idx - 10), idx);
    return !before.includes('](');
  });

  if (newBareMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] 检测到 ${newBareMatches.length} 个纯文本图片路径，开始上传...`);
    // 从后往前替换，避免 index 偏移
    for (const match of newBareMatches.reverse()) {
      const [fullMatch, rawPath] = match;
      log?.info?.(`[DingTalk][Media] 纯文本图片: "${fullMatch}" -> path="${rawPath}"`);
      const mediaId = await uploadMediaToDingTalk(rawPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (mediaId) {
        const replacement = `![](${mediaId})`;
        result = result.slice(0, match.index!) + result.slice(match.index!).replace(fullMatch, replacement);
        log?.info?.(`[DingTalk][Media] 替换纯文本路径为图片: ${replacement}`);
      }
    }
  }

  if (mdMatches.length === 0 && newBareMatches.length === 0) {
    log?.info?.(`[DingTalk][Media] 未检测到本地图片路径`);
  }

  return result;
}

// ============ 文件后处理：提取文件标记并发送独立消息 ============

/**
 * 文件标记正则：[DINGTALK_FILE]{"path":"...","fileName":"...","fileType":"..."}[/DINGTALK_FILE]
 */
const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\]({.*?})\[\/DINGTALK_FILE\]/g;

/** 视频大小限制：20MB */
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

// ============ 视频后处理：提取视频标记并发送视频消息 ============

/**
 * 视频标记正则：[DINGTALK_VIDEO]{"path":"..."}[/DINGTALK_VIDEO]
 */
const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\]({.*?})\[\/DINGTALK_VIDEO\]/g;

/** 视频信息接口 */
interface VideoInfo {
  path: string;
}

/** 视频元数据接口 */
interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/**
 * 提取视频元数据（时长、分辨率）
 */
async function extractVideoMetadata(
  filePath: string,
  log?: any,
): Promise<VideoMetadata | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) {
          log?.error?.(`[DingTalk][Video] 提取元数据失败: ${err.message}`);
          return reject(err);
        }

        const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
        if (!videoStream) {
          log?.warn?.(`[DingTalk][Video] 未找到视频流`);
          return resolve(null);
        }

        const result = {
          duration: Math.floor(metadata.format.duration || 0),
          width: videoStream.width || 0,
          height: videoStream.height || 0,
        };

        log?.info?.(`[DingTalk][Video] 元数据: duration=${result.duration}s, ${result.width}x${result.height}`);
        resolve(result);
      });
    });
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] ffprobe 失败: ${err.message}`);
    return null;
  }
}

/**
 * 生成视频封面图（第1秒截图）
 */
async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  log?: any,
): Promise<string | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const path = await import('path');
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timemarks: ['1'],
          size: '?x360',
        })
        .on('end', () => {
          log?.info?.(`[DingTalk][Video] 封面生成成功: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          log?.error?.(`[DingTalk][Video] 封面生成失败: ${err.message}`);
          reject(err);
        });
    });
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] ffmpeg 失败: ${err.message}`);
    return null;
  }
}

/**
 * 发送视频消息到钉钉
 */
async function sendVideoMessage(
  config: any,
  sessionWebhook: string,
  videoInfo: VideoInfo,
  videoMediaId: string,
  picMediaId: string,
  metadata: VideoMetadata,
  oapiToken: string,
  log?: any,
): Promise<void> {
  try {
    const path = await import('path');
    const fileName = path.basename(videoInfo.path);

    const payload = {
      msgtype: 'video',
      video: {
        duration: metadata.duration.toString(),
        videoMediaId: videoMediaId,
        videoType: 'mp4',
        picMediaId: picMediaId,
      },
    };

    log?.info?.(`[DingTalk][Video] 发送视频消息: ${fileName}, payload: ${JSON.stringify(payload)}`);
    const resp = await axios.post(sessionWebhook, payload, {
      headers: {
        'x-acs-dingtalk-access-token': oapiToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`[DingTalk][Video] 视频消息发送成功: ${fileName}`);
    } else {
      log?.error?.(`[DingTalk][Video] 视频消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] 发送失败: ${err.message}`);
  }
}

/**
 * 视频后处理主函数
 */
async function processVideoMarkers(
  content: string,
  sessionWebhook: string,
  config: any,
  oapiToken: string | null,
  log?: any,
): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][Video] 无 oapiToken，跳过视频处理`);
    return content;
  }

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  // 提取视频标记
  const matches = [...content.matchAll(VIDEO_MARKER_PATTERN)];
  const videoInfos: VideoInfo[] = [];

  for (const match of matches) {
    try {
      const videoInfo = JSON.parse(match[1]) as VideoInfo;
      if (videoInfo.path && fs.existsSync(videoInfo.path)) {
        videoInfos.push(videoInfo);
        log?.info?.(`[DingTalk][Video] 提取到视频: ${videoInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`[DingTalk][Video] 解析标记失败: ${err.message}`);
    }
  }

  if (videoInfos.length === 0) {
    log?.info?.(`[DingTalk][Video] 未检测到视频标记`);
    return content.replace(VIDEO_MARKER_PATTERN, '').trim();
  }

  log?.info?.(`[DingTalk][Video] 检测到 ${videoInfos.length} 个视频，开始处理...`);

  // 逐个处理视频
  for (const videoInfo of videoInfos) {
    try {
      // 1. 提取元数据
      const metadata = await extractVideoMetadata(videoInfo.path, log);
      if (!metadata) {
        log?.warn?.(`[DingTalk][Video] 无法提取元数据: ${videoInfo.path}`);
        continue;
      }

      // 2. 生成封面
      const thumbnailPath = path.join(
        os.tmpdir(),
        `thumbnail_${Date.now()}.jpg`,
      );
      const thumbnail = await extractVideoThumbnail(videoInfo.path, thumbnailPath, log);
      if (!thumbnail) {
        log?.warn?.(`[DingTalk][Video] 无法生成封面: ${videoInfo.path}`);
        continue;
      }

      // 3. 上传视频
      const videoMediaId = await uploadMediaToDingTalk(
        videoInfo.path,
        'video',
        oapiToken,
        MAX_VIDEO_SIZE,
        log,
      );
      if (!videoMediaId) {
        log?.warn?.(`[DingTalk][Video] 视频上传失败: ${videoInfo.path}`);
        fs.unlinkSync(thumbnailPath);
        continue;
      }

      // 4. 上传封面
      const picMediaId = await uploadMediaToDingTalk(
        thumbnailPath,
        'image',
        oapiToken,
        20 * 1024 * 1024,
        log,
      );
      if (!picMediaId) {
        log?.warn?.(`[DingTalk][Video] 封面上传失败: ${thumbnailPath}`);
        fs.unlinkSync(thumbnailPath);
        continue;
      }

      // 5. 发送视频消息
      await sendVideoMessage(
        config,
        sessionWebhook,
        videoInfo,
        videoMediaId,
        picMediaId,
        metadata,
        oapiToken,
        log,
      );

      // 6. 清理临时文件
      fs.unlinkSync(thumbnailPath);
      log?.info?.(`[DingTalk][Video] 视频处理完成: ${path.basename(videoInfo.path)}`);
    } catch (err: any) {
      log?.error?.(`[DingTalk][Video] 处理视频失败: ${err.message}`);
    }
  }

  // 移除视频标记
  return content.replace(VIDEO_MARKER_PATTERN, '').trim();
}

const FILE_EXTENSIONS = [
  // 文档类
  'xlsx', 'xls', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'csv',
  // 压缩包
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  // 代码文件
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cpp', 'c', 'h', 'go', 'rs',
  'json', 'xml', 'yaml', 'yml', 'html', 'css', 'scss', 'less',
  // 其他
  'log', 'sql', 'sh', 'bat', 'conf', 'ini', 'cfg', 'properties',
];

/** 文件大小限制：20MB（字节） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 文件信息接口 */
interface FileInfo {
  path: string;        // 本地文件路径
  fileName: string;    // 文件名
  fileType: string;    // 文件类型（扩展名）
}

/**
 * 从内容中提取文件标记
 * @returns { cleanedContent, fileInfos }
 */
function extractFileMarkers(content: string, log?: any): { cleanedContent: string; fileInfos: FileInfo[] } {
  const fileInfos: FileInfo[] = [];
  const matches = [...content.matchAll(FILE_MARKER_PATTERN)];

  for (const match of matches) {
    try {
      const fileInfo = JSON.parse(match[1]) as FileInfo;

      // 验证必需字段
      if (fileInfo.path && fileInfo.fileName && fileInfo.fileType) {
        // 验证文件类型
        if (FILE_EXTENSIONS.includes(fileInfo.fileType.toLowerCase())) {
          fileInfos.push(fileInfo);
          log?.info?.(`[DingTalk][File] 提取到文件标记: ${fileInfo.fileName}`);
        } else {
          log?.warn?.(`[DingTalk][File] 不支持的文件类型: ${fileInfo.fileType}`);
        }
      }
    } catch (err: any) {
      log?.warn?.(`[DingTalk][File] 解析文件标记失败: ${match[1]}, 错误: ${err.message}`);
    }
  }

  // 移除文件标记，返回清理后的内容
  const cleanedContent = content.replace(FILE_MARKER_PATTERN, '').trim();
  return { cleanedContent, fileInfos };
}


/**
 * 发送文件消息到钉钉
 */
async function sendFileMessage(
  config: any,
  sessionWebhook: string,
  fileInfo: FileInfo,
  mediaId: string,
  oapiToken: string,
  log?: any,
): Promise<void> {
  try {
    const fileMessage = {
      msgtype: 'file',
      file: {
        mediaId: mediaId,
        fileName: fileInfo.fileName,
        fileType: fileInfo.fileType,
      },
    };

    log?.info?.(`[DingTalk][File] 发送文件消息: ${fileInfo.fileName}`);
    const resp = await axios.post(sessionWebhook, fileMessage, {
      headers: {
        'x-acs-dingtalk-access-token': oapiToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`[DingTalk][File] 文件消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.error?.(`[DingTalk][File] 文件消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][File] 发送文件消息异常: ${fileInfo.fileName}, 错误: ${err.message}`);
  }
}

/**
 * 处理文件标记：提取、上传、发送独立消息
 */
async function processFileMarkers(
  content: string,
  sessionWebhook: string,
  config: any,
  oapiToken: string | null,
  log?: any,
): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][File] 无 oapiToken，跳过文件处理`);
    return content;
  }

  const { cleanedContent, fileInfos } = extractFileMarkers(content, log);

  if (fileInfos.length === 0) {
    log?.info?.(`[DingTalk][File] 未检测到文件标记`);
    return content;
  }

  log?.info?.(`[DingTalk][File] 检测到 ${fileInfos.length} 个文件标记，开始处理...`);

  // 逐个上传并发送文件消息
  for (const fileInfo of fileInfos) {
    const mediaId = await uploadMediaToDingTalk(fileInfo.path, 'file', oapiToken, MAX_FILE_SIZE, log);
    if (mediaId) {
      await sendFileMessage(config, sessionWebhook, fileInfo, mediaId, oapiToken, log);
    } else {
      log?.error?.(`[DingTalk][File] 文件上传失败，跳过发送: ${fileInfo.fileName}`);
    }
  }

  return cleanedContent;
}

// ============ AI Card Streaming ============

const DINGTALK_API = 'https://api.dingtalk.com';
const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

// flowStatus 值与 Python SDK AICardStatus 一致（cardParamMap 的值必须是字符串）
const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}

// 创建 AI Card 实例
async function createAICard(
  config: any,
  data: any,
  log?: any,
): Promise<AICardInstance | null> {
  try {
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(`[DingTalk][AICard] 开始创建卡片 outTrackId=${cardInstanceId}`);
    log?.info?.(`[DingTalk][AICard] conversationType=${data.conversationType}, conversationId=${data.conversationId}, senderStaffId=${data.senderStaffId}, senderId=${data.senderId}`);

    // 1. 创建卡片实例（Python SDK 传空 cardParamMap，不预设 flowStatus）
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: {
        cardParamMap: {},
      },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances body=${JSON.stringify(createBody)}`);
    const createResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances`, createBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 创建卡片响应: status=${createResp.status} data=${JSON.stringify(createResp.data)}`);

    // 2. 投放卡片
    const isGroup = data.conversationType === '2';
    const deliverBody: any = {
      outTrackId: cardInstanceId,
      userIdType: 1,
    };

    if (isGroup) {
      deliverBody.openSpaceId = `dtv1.card//IM_GROUP.${data.conversationId}`;
      deliverBody.imGroupOpenDeliverModel = {
        robotCode: config.clientId,
      };
    } else {
      const userId = data.senderStaffId || data.senderId;
      deliverBody.openSpaceId = `dtv1.card//IM_ROBOT.${userId}`;
      deliverBody.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
    }

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances/deliver body=${JSON.stringify(deliverBody)}`);
    const deliverResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances/deliver`, deliverBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 投放卡片响应: status=${deliverResp.status} data=${JSON.stringify(deliverResp.data)}`);

    return { cardInstanceId, accessToken: token, inputingStarted: false };
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] 创建卡片失败: ${err.message}`);
    if (err.response) {
      log?.error?.(`[DingTalk][AICard] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
    }
    return null;
  }
}

// 流式更新 AI Card 内容
async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: any,
): Promise<void> {
  // 首次 streaming 前，先切换到 INPUTING 状态（与 Python SDK get_card_data(INPUTING) 一致）
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: '',
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({
            order: ['msgContent'],  // 只声明实际使用的字段，避免部分客户端显示空占位
          }),
        },
      },
    };
    log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/instances (INPUTING) outTrackId=${card.cardInstanceId}`);
    try {
      const statusResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, statusBody, {
        headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
      });
      log?.info?.(`[DingTalk][AICard] INPUTING 响应: status=${statusResp.status} data=${JSON.stringify(statusResp.data)}`);
    } catch (err: any) {
      log?.error?.(`[DingTalk][AICard] INPUTING 切换失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
      throw err;
    }
    card.inputingStarted = true;
  }

  // 调用 streaming API 更新内容
  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: 'msgContent',
    content: content,
    isFull: true,  // 全量替换
    isFinalize: finished,
    isError: false,
  };

  log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/streaming contentLen=${content.length} isFinalize=${finished} guid=${body.guid}`);
  try {
    const streamResp = await axios.put(`${DINGTALK_API}/v1.0/card/streaming`, body, {
      headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] streaming 响应: status=${streamResp.status}`);
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] streaming 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
    throw err;
  }
}

// 完成 AI Card：先 streaming isFinalize 关闭流式通道，再 put_card_data 更新 FINISHED 状态
async function finishAICard(
  card: AICardInstance,
  content: string,
  log?: any,
): Promise<void> {
  log?.info?.(`[DingTalk][AICard] 开始 finish，最终内容长度=${content.length}`);

  // 1. 先用最终内容关闭流式通道（isFinalize=true），确保卡片显示替换后的内容
  await streamAICard(card, content, true, log);

  // 2. 更新卡片状态为 FINISHED
  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: content,
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({
          order: ['msgContent'],  // 只声明实际使用的字段，避免部分客户端显示空占位
        }),
      },
    },
  };

  log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/instances (FINISHED) outTrackId=${card.cardInstanceId}`);
  try {
    const finishResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, body, {
      headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] FINISHED 响应: status=${finishResp.status} data=${JSON.stringify(finishResp.data)}`);
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] FINISHED 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
  }
}

// ============ Gateway SSE Streaming ============

interface GatewayOptions {
  userContent: string;
  systemPrompts: string[];
  sessionKey: string;
  gatewayAuth?: string;  // token 或 password，都用 Bearer 格式
  log?: any;
}

async function* streamFromGateway(options: GatewayOptions): AsyncGenerator<string, void, unknown> {
  const { userContent, systemPrompts, sessionKey, gatewayAuth, log } = options;
  const rt = getRuntime();
  const gatewayUrl = `http://127.0.0.1:${rt.gateway?.port || 18789}/v1/chat/completions`;

  const messages: any[] = [];
  for (const prompt of systemPrompts) {
    messages.push({ role: 'system', content: prompt });
  }
  messages.push({ role: 'user', content: userContent });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gatewayAuth) {
    headers['Authorization'] = `Bearer ${gatewayAuth}`;
  }

  log?.info?.(`[DingTalk][Gateway] POST ${gatewayUrl}, session=${sessionKey}, messages=${messages.length}`);

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'default',
      messages,
      stream: true,
      user: sessionKey,  // 用于 session 持久化
    }),
  });

  log?.info?.(`[DingTalk][Gateway] 响应 status=${response.status}, ok=${response.ok}, hasBody=${!!response.body}`);

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : '(no body)';
    log?.error?.(`[DingTalk][Gateway] 错误响应: ${errText}`);
    throw new Error(`Gateway error: ${response.status} - ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {}
    }
  }
}

// ============ 消息处理 ============

function extractMessageContent(data: any): { text: string; messageType: string } {
  const msgtype = data.msgtype || 'text';
  switch (msgtype) {
    case 'text':
      return { text: data.text?.content?.trim() || '', messageType: 'text' };
    case 'richText': {
      const parts = data.content?.richText || [];
      const text = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
      return { text: text || '[富文本消息]', messageType: 'richText' };
    }
    case 'picture':
      return { text: '[图片]', messageType: 'picture' };
    case 'audio':
      return { text: data.content?.recognition || '[语音消息]', messageType: 'audio' };
    case 'video':
      return { text: '[视频]', messageType: 'video' };
    case 'file':
      return { text: `[文件: ${data.content?.fileName || '文件'}]`, messageType: 'file' };
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
  }
}

// 发送 Markdown 消息
async function sendMarkdownMessage(
  config: any,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  let text = markdown;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: 'markdown',
    markdown: { title: title || 'Moltbot', text },
  };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (await axios.post(sessionWebhook, body, {
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
  })).data;
}

// 发送文本消息
async function sendTextMessage(
  config: any,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  const body: any = { msgtype: 'text', text: { content: text } };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (await axios.post(sessionWebhook, body, {
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
  })).data;
}

// 智能选择 text / markdown
async function sendMessage(
  config: any,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(text) || text.includes('\n');
  const useMarkdown = options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);

  if (useMarkdown) {
    const title = options.title
      || text.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20)
      || 'Moltbot';
    return sendMarkdownMessage(config, sessionWebhook, title, text, options);
  }
  return sendTextMessage(config, sessionWebhook, text, options);
}

// ============ 主动发送消息 API ============

/** 消息类型枚举 */
type DingTalkMsgType = 'text' | 'markdown' | 'link' | 'actionCard' | 'image';

/** 主动发送消息的结果 */
interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;  // AI Card 成功时返回
  error?: string;
  usedAICard?: boolean;  // 是否使用了 AI Card
}

/** 主动发送选项 */
interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  title?: string;
  log?: any;
  useAICard?: boolean;  // 是否使用 AI Card，默认 true
  fallbackToNormal?: boolean;  // AI Card 失败时是否降级到普通消息，默认 true
}

/** AI Card 投放目标类型 */
type AICardTarget =
  | { type: 'user'; userId: string }
  | { type: 'group'; openConversationId: string };

/**
 * 主动创建并发送 AI Card（通用内部实现）
 * @param config 钉钉配置
 * @param target 投放目标（单聊或群聊）
 * @param content 消息内容
 * @param log 日志对象
 * @returns SendResult
 */
async function sendAICardInternal(
  config: any,
  target: AICardTarget,
  content: string,
  log?: any,
): Promise<SendResult> {
  const isGroup = target.type === 'group';
  const targetId = isGroup ? target.openConversationId : target.userId;
  const targetDesc = isGroup ? `群聊 ${targetId}` : `用户 ${targetId}`;

  try {
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(`[DingTalk][AICard][Proactive] 开始创建卡片: ${targetDesc}, outTrackId=${cardInstanceId}`);

    // 0. 图片后处理：上传本地图片到钉钉，替换路径为 media_id
    let processedContent = content;
    const oapiToken = await getOapiAccessToken(config);
    if (oapiToken) {
      log?.info?.(`[DingTalk][AICard][Proactive] 开始图片后处理，内容片段="${content.slice(0, 200)}..."`);
      processedContent = await processLocalImages(content, oapiToken, log);
    } else {
      log?.warn?.(`[DingTalk][AICard][Proactive] 无法获取 oapiToken，跳过图片后处理`);
    }

    // 1. 创建卡片实例
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: { cardParamMap: {} },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    log?.info?.(`[DingTalk][AICard][Proactive] POST /v1.0/card/instances`);
    const createResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances`, createBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard][Proactive] 创建卡片响应: status=${createResp.status}`);

    // 2. 投放卡片
    const deliverBody: any = {
      outTrackId: cardInstanceId,
      userIdType: 1,
    };

    if (isGroup) {
      deliverBody.openSpaceId = `dtv1.card//IM_GROUP.${target.openConversationId}`;
      deliverBody.imGroupOpenDeliverModel = { robotCode: config.clientId };
    } else {
      deliverBody.openSpaceId = `dtv1.card//IM_ROBOT.${target.userId}`;
      deliverBody.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
    }

    log?.info?.(`[DingTalk][AICard][Proactive] POST /v1.0/card/instances/deliver`);
    const deliverResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances/deliver`, deliverBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard][Proactive] 投放卡片响应: status=${deliverResp.status}`);

    // 3. 使用 finishAICard 流程来设置内容（必须通过 streaming API）
    const card: AICardInstance = { cardInstanceId, accessToken: token, inputingStarted: false };
    await finishAICard(card, processedContent, log);

    log?.info?.(`[DingTalk][AICard][Proactive] AI Card 发送成功: ${targetDesc}, cardInstanceId=${cardInstanceId}`);
    return { ok: true, cardInstanceId, usedAICard: true };

  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard][Proactive] AI Card 发送失败 (${targetDesc}): ${err.message}`);
    if (err.response) {
      log?.error?.(`[DingTalk][AICard][Proactive] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
    }
    return { ok: false, error: err.response?.data?.message || err.message, usedAICard: false };
  }
}

/**
 * 主动发送 AI Card 到单聊用户
 */
async function sendAICardToUser(
  config: any,
  userId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(config, { type: 'user', userId }, content, log);
}

/**
 * 主动发送 AI Card 到群聊
 */
async function sendAICardToGroup(
  config: any,
  openConversationId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(config, { type: 'group', openConversationId }, content, log);
}

/**
 * 使用普通消息 API 发送单聊消息（降级方案）
 */
async function sendNormalToUser(
  config: any,
  userIds: string | string[],
  content: string,
  options: { msgType?: DingTalkMsgType; title?: string; log?: any } = {},
): Promise<SendResult> {
  const { msgType = 'text', title, log } = options;

  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  try {
    const token = await getAccessToken(config);

    // 构建消息参数
    let msgKey: string;
    let msgParam: Record<string, any>;

    switch (msgType) {
      case 'markdown':
        msgKey = 'sampleMarkdown';
        msgParam = {
          title: title || content.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
          text: content,
        };
        break;
      case 'link':
        msgKey = 'sampleLink';
        try {
          msgParam = typeof content === 'string' ? JSON.parse(content) : content;
        } catch {
          return { ok: false, error: 'Invalid link message format, expected JSON', usedAICard: false };
        }
        break;
      case 'actionCard':
        msgKey = 'sampleActionCard';
        try {
          msgParam = typeof content === 'string' ? JSON.parse(content) : content;
        } catch {
          return { ok: false, error: 'Invalid actionCard message format, expected JSON', usedAICard: false };
        }
        break;
      case 'image':
        msgKey = 'sampleImageMsg';
        msgParam = { photoURL: content };
        break;
      case 'text':
      default:
        msgKey = 'sampleText';
        msgParam = { content };
        break;
    }

    const body = {
      robotCode: config.clientId,
      userIds: userIdArray,
      msgKey,
      msgParam: JSON.stringify(msgParam),
    };

    log?.info?.(`[DingTalk][Normal] 发送单聊消息: userIds=${userIdArray.join(',')}, msgType=${msgType}`);

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, body, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`);
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    }

    log?.warn?.(`[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`);
    return { ok: false, error: resp.data?.message || 'Unknown error', usedAICard: false };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`[DingTalk][Normal] 发送失败: ${errMsg}`);
    return { ok: false, error: errMsg, usedAICard: false };
  }
}

/**
 * 使用普通消息 API 发送群聊消息（降级方案）
 */
async function sendNormalToGroup(
  config: any,
  openConversationId: string,
  content: string,
  options: { msgType?: DingTalkMsgType; title?: string; log?: any } = {},
): Promise<SendResult> {
  const { msgType = 'text', title, log } = options;

  try {
    const token = await getAccessToken(config);

    // 构建消息参数
    let msgKey: string;
    let msgParam: Record<string, any>;

    switch (msgType) {
      case 'markdown':
        msgKey = 'sampleMarkdown';
        msgParam = {
          title: title || content.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
          text: content,
        };
        break;
      case 'link':
        msgKey = 'sampleLink';
        try {
          msgParam = typeof content === 'string' ? JSON.parse(content) : content;
        } catch {
          return { ok: false, error: 'Invalid link message format, expected JSON', usedAICard: false };
        }
        break;
      case 'actionCard':
        msgKey = 'sampleActionCard';
        try {
          msgParam = typeof content === 'string' ? JSON.parse(content) : content;
        } catch {
          return { ok: false, error: 'Invalid actionCard message format, expected JSON', usedAICard: false };
        }
        break;
      case 'image':
        msgKey = 'sampleImageMsg';
        msgParam = { photoURL: content };
        break;
      case 'text':
      default:
        msgKey = 'sampleText';
        msgParam = { content };
        break;
    }

    const body = {
      robotCode: config.clientId,
      openConversationId,
      msgKey,
      msgParam: JSON.stringify(msgParam),
    };

    log?.info?.(`[DingTalk][Normal] 发送群聊消息: openConversationId=${openConversationId}, msgType=${msgType}`);

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/groupMessages/send`, body, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`);
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    }

    log?.warn?.(`[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`);
    return { ok: false, error: resp.data?.message || 'Unknown error', usedAICard: false };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`[DingTalk][Normal] 发送失败: ${errMsg}`);
    return { ok: false, error: errMsg, usedAICard: false };
  }
}

/**
 * 主动发送单聊消息给指定用户
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置（需包含 clientId 和 clientSecret）
 * @param userIds 用户 ID 数组（staffId 或 unionId）
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendToUser(
  config: any,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (!config.clientId || !config.clientSecret) {
    return { ok: false, error: 'Missing clientId or clientSecret', usedAICard: false };
  }

  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];
  if (userIdArray.length === 0) {
    return { ok: false, error: 'userIds cannot be empty', usedAICard: false };
  }

  // AI Card 只支持单个用户
  if (useAICard && userIdArray.length === 1) {
    log?.info?.(`[DingTalk][SendToUser] 尝试使用 AI Card 发送: userId=${userIdArray[0]}`);
    const cardResult = await sendAICardToUser(config, userIdArray[0], content, log);

    if (cardResult.ok) {
      return cardResult;
    }

    // AI Card 失败
    log?.warn?.(`[DingTalk][SendToUser] AI Card 发送失败: ${cardResult.error}`);

    if (!fallbackToNormal) {
      log?.error?.(`[DingTalk][SendToUser] 不降级到普通消息，返回错误`);
      return cardResult;
    }

    log?.info?.(`[DingTalk][SendToUser] 降级到普通消息发送`);
  } else if (useAICard && userIdArray.length > 1) {
    log?.info?.(`[DingTalk][SendToUser] 多用户发送不支持 AI Card，使用普通消息`);
  }

  // 使用普通消息
  return sendNormalToUser(config, userIdArray, content, options);
}

/**
 * 主动发送群聊消息到指定群
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置（需包含 clientId 和 clientSecret）
 * @param openConversationId 群会话 ID
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendToGroup(
  config: any,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (!config.clientId || !config.clientSecret) {
    return { ok: false, error: 'Missing clientId or clientSecret', usedAICard: false };
  }

  if (!openConversationId) {
    return { ok: false, error: 'openConversationId cannot be empty', usedAICard: false };
  }

  // 尝试使用 AI Card
  if (useAICard) {
    log?.info?.(`[DingTalk][SendToGroup] 尝试使用 AI Card 发送: openConversationId=${openConversationId}`);
    const cardResult = await sendAICardToGroup(config, openConversationId, content, log);

    if (cardResult.ok) {
      return cardResult;
    }

    // AI Card 失败
    log?.warn?.(`[DingTalk][SendToGroup] AI Card 发送失败: ${cardResult.error}`);

    if (!fallbackToNormal) {
      log?.error?.(`[DingTalk][SendToGroup] 不降级到普通消息，返回错误`);
      return cardResult;
    }

    log?.info?.(`[DingTalk][SendToGroup] 降级到普通消息发送`);
  }

  // 使用普通消息
  return sendNormalToGroup(config, openConversationId, content, options);
}

/**
 * 智能发送消息
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置
 * @param target 目标：{ userId } 或 { openConversationId }
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendProactive(
  config: any,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  // 自动检测是否使用 markdown（用于降级时）
  if (!options.msgType) {
    const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(content) || content.includes('\n');
    if (hasMarkdown) {
      options.msgType = 'markdown';
    }
  }

  // 发送到用户
  if (target.userId || target.userIds) {
    const userIds = target.userIds || [target.userId!];
    return sendToUser(config, userIds, content, options);
  }

  // 发送到群
  if (target.openConversationId) {
    return sendToGroup(config, target.openConversationId, content, options);
  }

  return { ok: false, error: 'Must specify userId, userIds, or openConversationId', usedAICard: false };
}

// ============ 核心消息处理 (AI Card Streaming) ============

async function handleDingTalkMessage(params: {
  cfg: ClawdbotConfig;
  accountId: string;
  data: any;
  sessionWebhook: string;
  log?: any;
  dingtalkConfig: any;
}): Promise<void> {
  const { cfg, accountId, data, sessionWebhook, log, dingtalkConfig } = params;
  const rt = getRuntime();

  const content = extractMessageContent(data);
  if (!content.text) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';

  log?.info?.(`[DingTalk] 收到消息: from=${senderName} text="${content.text.slice(0, 50)}..."`);

  // ===== Session 管理 =====
  const sessionTimeout = dingtalkConfig.sessionTimeout ?? 1800000; // 默认 30 分钟
  const forceNewSession = isNewSessionCommand(content.text);

  // 如果是新会话命令，直接回复确认消息
  if (forceNewSession) {
    const { sessionKey } = getSessionKey(senderId, true, sessionTimeout, log);
    await sendMessage(dingtalkConfig, sessionWebhook, '✨ 已开启新会话，之前的对话已清空。', {
      atUserId: !isDirect ? senderId : null,
    });
    log?.info?.(`[DingTalk] 用户请求新会话: ${senderId}, newKey=${sessionKey}`);
    return;
  }

  // 获取或创建 session
  const { sessionKey, isNew } = getSessionKey(senderId, false, sessionTimeout, log);
  log?.info?.(`[DingTalk][Session] key=${sessionKey}, isNew=${isNew}`);

  // Gateway 认证：优先使用 token，其次 password
  const gatewayAuth = dingtalkConfig.gatewayToken || dingtalkConfig.gatewayPassword || '';

  // 构建 system prompts & 获取 oapi token（用于图片和文件后处理）
  const systemPrompts: string[] = [];
  let oapiToken: string | null = null;

  if (dingtalkConfig.enableMediaUpload !== false) {
    // 添加图片和文件使用提示（告诉 LLM 直接输出本地路径或文件标记）
    systemPrompts.push(buildMediaSystemPrompt());
    // 获取 token 用于后处理上传
    oapiToken = await getOapiAccessToken(dingtalkConfig);
    log?.info?.(`[DingTalk][Media] oapiToken 获取${oapiToken ? '成功' : '失败'}`);
  } else {
    log?.info?.(`[DingTalk][Media] enableMediaUpload=false，跳过`);
  }

  // 自定义 system prompt
  if (dingtalkConfig.systemPrompt) {
    systemPrompts.push(dingtalkConfig.systemPrompt);
  }

  // 尝试创建 AI Card
  const card = await createAICard(dingtalkConfig, data, log);

  if (card) {
    // ===== AI Card 流式模式 =====
    log?.info?.(`[DingTalk] AI Card 创建成功: ${card.cardInstanceId}`);

    let accumulated = '';
    let lastUpdateTime = 0;
    const updateInterval = 300; // 最小更新间隔 ms
    let chunkCount = 0;

    try {
      log?.info?.(`[DingTalk] 开始请求 Gateway 流式接口...`);
      for await (const chunk of streamFromGateway({
        userContent: content.text,
        systemPrompts,
        sessionKey,
        gatewayAuth,
        log,
      })) {
        accumulated += chunk;
        chunkCount++;

        if (chunkCount <= 3) {
          log?.info?.(`[DingTalk] Gateway chunk #${chunkCount}: "${chunk.slice(0, 50)}..." (accumulated=${accumulated.length})`);
        }

        // 节流更新，避免过于频繁
        const now = Date.now();
        if (now - lastUpdateTime >= updateInterval) {
          // 实时清理文件和视频标记（避免用户在流式过程中看到标记）
          const displayContent = accumulated
            .replace(FILE_MARKER_PATTERN, '')
            .replace(VIDEO_MARKER_PATTERN, '')
            .trim();
          await streamAICard(card, displayContent, false, log);
          lastUpdateTime = now;
        }
      }

      log?.info?.(`[DingTalk] Gateway 流完成，共 ${chunkCount} chunks, ${accumulated.length} 字符`);

      // 后处理01：上传本地图片到钉钉，替换 file:// 路径为 media_id
      log?.info?.(`[DingTalk][Media] 开始图片后处理，内容片段="${accumulated.slice(0, 200)}..."`);
      accumulated = await processLocalImages(accumulated, oapiToken, log);

      // 后处理02：提取文件标记并发送独立文件消息
      log?.info?.(`[DingTalk][File] 开始文件后处理`);
      accumulated = await processFileMarkers(accumulated, sessionWebhook, dingtalkConfig, oapiToken, log);

      // 后处理03：提取视频标记并发送视频消息
      log?.info?.(`[DingTalk][Video] 开始视频后处理`);
      accumulated = await processVideoMarkers(accumulated, sessionWebhook, dingtalkConfig, oapiToken, log);

      // 完成 AI Card
      await finishAICard(card, accumulated, log);
      log?.info?.(`[DingTalk] 流式响应完成，共 ${accumulated.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
      log?.error?.(`[DingTalk] 错误详情: ${err.stack}`);
      accumulated += `\n\n⚠️ 响应中断: ${err.message}`;
      try {
        await finishAICard(card, accumulated, log);
      } catch (finishErr: any) {
        log?.error?.(`[DingTalk] 错误恢复 finish 也失败: ${finishErr.message}`);
      }
    }

  } else {
    // ===== 降级：普通消息模式 =====
    log?.warn?.(`[DingTalk] AI Card 创建失败，降级为普通消息`);

    let fullResponse = '';
    try {
      for await (const chunk of streamFromGateway({
        userContent: content.text,
        systemPrompts,
        sessionKey,
        gatewayAuth,
        log,
      })) {
        fullResponse += chunk;
      }

      // 后处理01：上传本地图片到钉钉，替换 file:// 路径为 media_id
      log?.info?.(`[DingTalk][Media] (降级模式) 开始图片后处理，内容片段="${fullResponse.slice(0, 200)}..."`);
      fullResponse = await processLocalImages(fullResponse, oapiToken, log);

      // 后处理02：提取文件标记并发送独立文件消息
      log?.info?.(`[DingTalk][File] (降级模式) 开始文件后处理`);
      fullResponse = await processFileMarkers(fullResponse, sessionWebhook, dingtalkConfig, oapiToken, log);

      // 后处理03：提取视频标记并发送视频消息
      log?.info?.(`[DingTalk][Video] (降级模式) 开始视频后处理`);
      fullResponse = await processVideoMarkers(fullResponse, sessionWebhook, dingtalkConfig, oapiToken, log);

      await sendMessage(dingtalkConfig, sessionWebhook, fullResponse || '（无响应）', {
        atUserId: !isDirect ? senderId : null,
        useMarkdown: true,
      });
      log?.info?.(`[DingTalk] 普通消息回复完成，共 ${fullResponse.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
      await sendMessage(dingtalkConfig, sessionWebhook, `抱歉，处理请求时出错: ${err.message}`, {
        atUserId: !isDirect ? senderId : null,
      });
    }
  }
}

// ============ 插件定义 ============

const meta = {
  id: 'dingtalk-connector',
  label: 'DingTalk',
  selectionLabel: 'DingTalk (钉钉)',
  docsPath: '/channels/dingtalk-connector',
  docsLabel: 'dingtalk-connector',
  blurb: '钉钉企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。',
  order: 70,
  aliases: ['dd', 'ding'],
};

const dingtalkPlugin = {
  id: 'dingtalk-connector',
  meta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ['channels.dingtalk-connector'] },
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', default: true },
        clientId: { type: 'string', description: 'DingTalk App Key (Client ID)' },
        clientSecret: { type: 'string', description: 'DingTalk App Secret (Client Secret)' },
        enableMediaUpload: { type: 'boolean', default: true, description: 'Enable media upload prompt injection' },
        systemPrompt: { type: 'string', default: '', description: 'Custom system prompt' },
        dmPolicy: { type: 'string', enum: ['open', 'pairing', 'allowlist'], default: 'open' },
        allowFrom: { type: 'array', items: { type: 'string' }, description: 'Allowed sender IDs' },
        groupPolicy: { type: 'string', enum: ['open', 'allowlist'], default: 'open' },
        gatewayToken: { type: 'string', default: '', description: 'Gateway auth token (Bearer)' },
        gatewayPassword: { type: 'string', default: '', description: 'Gateway auth password (alternative to token)' },
        sessionTimeout: { type: 'number', default: 1800000, description: 'Session timeout in ms (default 30min)' },
        debug: { type: 'boolean', default: false },
      },
      required: ['clientId', 'clientSecret'],
    },
    uiHints: {
      enabled: { label: 'Enable DingTalk' },
      clientId: { label: 'App Key', sensitive: false },
      clientSecret: { label: 'App Secret', sensitive: true },
      dmPolicy: { label: 'DM Policy' },
      groupPolicy: { label: 'Group Policy' },
    },
  },
  config: {
    listAccountIds: (cfg: ClawdbotConfig) => {
      const config = getConfig(cfg);
      return config.accounts
        ? Object.keys(config.accounts)
        : (isConfigured(cfg) ? ['default'] : []);
    },
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string) => {
      const config = getConfig(cfg);
      const id = accountId || 'default';
      if (config.accounts?.[id]) {
        return { accountId: id, config: config.accounts[id], enabled: config.accounts[id].enabled !== false };
      }
      return { accountId: 'default', config, enabled: config.enabled !== false };
    },
    defaultAccountId: () => 'default',
    isConfigured: (account: any) => Boolean(account.config?.clientId && account.config?.clientSecret),
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.config?.name || 'DingTalk',
      enabled: account.enabled,
      configured: Boolean(account.config?.clientId),
    }),
  },
  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: account.config?.dmPolicy || 'open',
      allowFrom: account.config?.allowFrom || [],
      policyPath: 'channels.dingtalk-connector.dmPolicy',
      allowFromPath: 'channels.dingtalk-connector.allowFrom',
      approveHint: '使用 /allow dingtalk-connector:<userId> 批准用户',
      normalizeEntry: (raw: string) => raw.replace(/^(dingtalk-connector|dingtalk|dd|ding):/i, ''),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: any) => getConfig(cfg).groupPolicy !== 'open',
  },
  messaging: {
    normalizeTarget: ({ target }: any) =>
      target ? { targetId: target.replace(/^(dingtalk-connector|dingtalk|dd|ding):/i, '') } : null,
    targetResolver: {
      looksLikeId: (id: string) => /^[\w-]+$/.test(id),
      hint: '<conversationId>',
    },
  },
  outbound: {
    deliveryMode: 'direct' as const,
    textChunkLimit: 4000,
    /**
     * 主动发送文本消息
     * @param ctx.to 目标格式：user:<userId> 或 group:<openConversationId>
     * @param ctx.text 消息内容
     * @param ctx.accountId 账号 ID
     */
    sendText: async (ctx: any) => {
      const { cfg, to, text, accountId } = ctx;
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);
      const config = account?.config;

      if (!config?.clientId || !config?.clientSecret) {
        throw new Error('DingTalk not configured');
      }

      if (!to) {
        throw new Error('Target is required. Format: user:<userId> or group:<openConversationId>');
      }

      // 解析目标：user:<userId> 或 group:<openConversationId>
      const targetStr = String(to);
      let result: SendResult;

      if (targetStr.startsWith('user:')) {
        const userId = targetStr.slice(5);
        result = await sendToUser(config, userId, text, {});
      } else if (targetStr.startsWith('group:')) {
        const openConversationId = targetStr.slice(6);
        result = await sendToGroup(config, openConversationId, text, {});
      } else {
        // 默认当作 userId 处理
        result = await sendToUser(config, targetStr, text, {});
      }

      if (result.ok) {
        return { channel: 'dingtalk-connector', messageId: result.processQueryKey || 'unknown' };
      }
      throw new Error(result.error || 'Failed to send message');
    },
    /**
     * 主动发送媒体消息（图片）
     * @param ctx.to 目标格式：user:<userId> 或 group:<openConversationId>
     * @param ctx.text 消息文本/标题
     * @param ctx.mediaUrl 媒体 URL（钉钉仅支持图片 URL）
     * @param ctx.accountId 账号 ID
     */
    sendMedia: async (ctx: any) => {
      const { cfg, to, text, mediaUrl, accountId } = ctx;
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);
      const config = account?.config;

      if (!config?.clientId || !config?.clientSecret) {
        throw new Error('DingTalk not configured');
      }

      if (!to) {
        throw new Error('Target is required. Format: user:<userId> or group:<openConversationId>');
      }

      // 解析目标
      const targetStr = String(to);
      let result: SendResult;

      // 如果有媒体 URL，发送图片消息
      if (mediaUrl) {
        if (targetStr.startsWith('user:')) {
          const userId = targetStr.slice(5);
          result = await sendToUser(config, userId, mediaUrl, { msgType: 'image' });
        } else if (targetStr.startsWith('group:')) {
          const openConversationId = targetStr.slice(6);
          result = await sendToGroup(config, openConversationId, mediaUrl, { msgType: 'image' });
        } else {
          result = await sendToUser(config, targetStr, mediaUrl, { msgType: 'image' });
        }
      } else {
        // 无媒体，发送文本
        if (targetStr.startsWith('user:')) {
          const userId = targetStr.slice(5);
          result = await sendToUser(config, userId, text || '', {});
        } else if (targetStr.startsWith('group:')) {
          const openConversationId = targetStr.slice(6);
          result = await sendToGroup(config, openConversationId, text || '', {});
        } else {
          result = await sendToUser(config, targetStr, text || '', {});
        }
      }

      if (result.ok) {
        return { channel: 'dingtalk-connector', messageId: result.processQueryKey || 'unknown' };
      }
      throw new Error(result.error || 'Failed to send media');
    },
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      if (!config.clientId || !config.clientSecret) {
        throw new Error('DingTalk clientId and clientSecret are required');
      }

      ctx.log?.info(`[${account.accountId}] 启动钉钉 Stream 客户端...`);

      const client = new DWClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        debug: config.debug || false,
      });

      client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
        try {
          const messageId = res.headers?.messageId;
          ctx.log?.info?.(`[DingTalk] 收到 Stream 回调, messageId=${messageId}, headers=${JSON.stringify(res.headers)}`);
          ctx.log?.info?.(`[DingTalk] 原始 data: ${typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500)}`);
          const data = JSON.parse(res.data);

          await handleDingTalkMessage({
            cfg,
            accountId: account.accountId,
            data,
            sessionWebhook: data.sessionWebhook,
            log: ctx.log,
            dingtalkConfig: config,
          });

          if (messageId) client.socketCallBackResponse(messageId, { success: true });
        } catch (error: any) {
          ctx.log?.error?.(`[DingTalk] 处理消息异常: ${error.message}`);
          const messageId = res.headers?.messageId;
          if (messageId) client.socketCallBackResponse(messageId, { success: false });
        }
      });

      await client.connect();
      ctx.log?.info(`[${account.accountId}] 钉钉 Stream 客户端已连接`);

      const rt = getRuntime();
      rt.channel.activity.record('dingtalk-connector', account.accountId, 'start');

      let stopped = false;
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (stopped) return;
          stopped = true;
          ctx.log?.info(`[${account.accountId}] 停止钉钉 Stream 客户端...`);
          rt.channel.activity.record('dingtalk-connector', account.accountId, 'stop');
        });
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          ctx.log?.info(`[${account.accountId}] 钉钉 Channel 已停止`);
          rt.channel.activity.record('dingtalk-connector', account.accountId, 'stop');
        },
      };
    },
  },
  status: {
    defaultRuntime: { accountId: 'default', running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    probe: async ({ cfg }: any) => {
      if (!isConfigured(cfg)) return { ok: false, error: 'Not configured' };
      try {
        const config = getConfig(cfg);
        await getAccessToken(config);
        return { ok: true, details: { clientId: config.clientId } };
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    },
    buildChannelSummary: ({ snapshot }: any) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};

// ============ 插件注册 ============

const plugin = {
  id: 'dingtalk-connector',
  name: 'DingTalk Channel',
  description: 'DingTalk (钉钉) messaging channel via Stream mode with AI Card streaming',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: { enabled: { type: 'boolean', default: true } },
  },
  register(api: ClawdbotPluginApi) {
    runtime = api.runtime;
    api.registerChannel({ plugin: dingtalkPlugin });

    // ===== Gateway Methods =====

    api.registerGatewayMethod('dingtalk-connector.status', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(true, result);
    });

    api.registerGatewayMethod('dingtalk-connector.probe', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(result.ok, result);
    });

    /**
     * 主动发送单聊消息
     * 参数：
     *   - userId / userIds: 目标用户 ID（支持单个或数组）
     *   - content: 消息内容
     *   - msgType?: 'text' | 'markdown' | 'link' | 'actionCard' | 'image'（降级时使用，默认 text）
     *   - title?: markdown 消息标题
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 使用的账号 ID（默认 default）
     */
    api.registerGatewayMethod('dingtalk-connector.sendToUser', async ({ respond, cfg, params, log }: any) => {
      const { userId, userIds, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      const targetUserIds = userIds || (userId ? [userId] : []);
      if (targetUserIds.length === 0) {
        return respond(false, { error: 'userId or userIds is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendToUser(account.config, targetUserIds, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,  // 默认 true
        fallbackToNormal: fallbackToNormal !== false,  // 默认 true
      });
      respond(result.ok, result);
    });

    /**
     * 主动发送群聊消息
     * 参数：
     *   - openConversationId: 群会话 ID
     *   - content: 消息内容
     *   - msgType?: 'text' | 'markdown' | 'link' | 'actionCard' | 'image'（降级时使用，默认 text）
     *   - title?: markdown 消息标题
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 使用的账号 ID（默认 default）
     */
    api.registerGatewayMethod('dingtalk-connector.sendToGroup', async ({ respond, cfg, params, log }: any) => {
      const { openConversationId, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!openConversationId) {
        return respond(false, { error: 'openConversationId is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendToGroup(account.config, openConversationId, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });
      respond(result.ok, result);
    });

    /**
     * 智能发送消息（自动检测目标类型和消息格式）
     * 参数：
     *   - target: 目标（user:<userId> 或 group:<openConversationId>）
     *   - content: 消息内容
     *   - msgType?: 消息类型（降级时使用，可选，不指定则自动检测）
     *   - title?: 标题（用于 markdown）
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.send', async ({ respond, cfg, params, log }: any) => {
      const { target, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!target) {
        return respond(false, { error: 'target is required (format: user:<userId> or group:<openConversationId>)' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const targetStr = String(target);
      let sendTarget: { userId?: string; openConversationId?: string };

      if (targetStr.startsWith('user:')) {
        sendTarget = { userId: targetStr.slice(5) };
      } else if (targetStr.startsWith('group:')) {
        sendTarget = { openConversationId: targetStr.slice(6) };
      } else {
        // 默认当作 userId
        sendTarget = { userId: targetStr };
      }

      const result = await sendProactive(account.config, sendTarget, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });
      respond(result.ok, result);
    });

    api.logger?.info('[DingTalk] 插件已注册（支持主动发送 AI Card 消息）');
  },
};

export default plugin;
export {
  dingtalkPlugin,
  // 回复消息（需要 sessionWebhook）
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
  // 主动发送消息（无需 sessionWebhook）
  sendToUser,
  sendToGroup,
  sendProactive,
};
