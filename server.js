const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const ffmpeg     = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuid } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const app    = express();
const PORT   = process.env.PORT || 3000;
const ORIGIN = process.env.FRONTEND_URL || 'https://bpzmethod.netlify.app';

app.use(cors({ origin: ORIGIN }));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

// Health check
app.get('/', (_, res) => res.json({ status: 'ok' }));

// Process video
app.post('/process', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const mode    = req.body.mode || 'patch';
  const inPath  = req.file.path;
  const outName = uuid() + '.mp4';
  const outPath = path.join(os.tmpdir(), outName);

  const cmd = ffmpeg(inPath);

  if (mode === 'patch') {
    // Fast: copy stream + inject bt709 color flags + faststart
    cmd
      .outputOptions([
        '-c:v', 'copy',
        '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-metadata', 'encoded_by=bpzmethod.netlify.app',
        '-metadata', 'encoder=BPZMethod-Encoder-v1.0',
        '-metadata', 'comment=Encoded by bpzmethod.netlify.app'
      ]);
  } else {
    // Full re-encode: TikTok-optimised H.264
    const fps     = req.body.fps     || '60';
    const bitrate = req.body.bitrate || '8';
    const res_    = req.body.res     || 'source';

    const vfFilters = [];
    if (res_ === '1080x1920') vfFilters.push('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
    else if (res_ === '720x1280') vfFilters.push('scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2');

    const opts = [
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-profile:v', 'high',
      '-level:v', '4.1',
      '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-b:v', bitrate + 'M',
      '-maxrate', (parseInt(bitrate) * 1.5) + 'M',
      '-bufsize', (parseInt(bitrate) * 2)  + 'M',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      '-metadata', 'encoded_by=bpzmethod.netlify.app',
      '-metadata', 'encoder=BPZMethod-Encoder-v1.0',
      '-metadata', 'comment=Encoded by bpzmethod.netlify.app'
    ];

    if (fps !== 'source') opts.push('-r', fps);
    if (vfFilters.length) opts.push('-vf', vfFilters.join(','));

    cmd.outputOptions(opts);
  }

  cmd
    .output(outPath)
    .on('end', () => {
      fs.unlink(inPath, () => {});
      const stat = fs.statSync(outPath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="output_bpzmethod.mp4"');
      res.setHeader('Content-Length', stat.size);
      const stream = fs.createReadStream(outPath);
      stream.pipe(res);
      stream.on('close', () => fs.unlink(outPath, () => {}));
    })
    .on('error', (err) => {
      fs.unlink(inPath, () => {});
      fs.unlink(outPath, () => {});
      res.status(500).json({ error: err.message });
    })
    .run();
});

app.listen(PORT, () => console.log(`BPZMethod backend running on port ${PORT}`));
