import {spawn} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'

const MIN_VERSION = [4, 4, 0]

export interface FFmpegInfo {
	version: string
}
export interface PcmFormat {
	sampleRate: number
	bitsPerSample: number
	channels: number
}

export async function checkFFmpeg(): Promise<FFmpegInfo> {
	const version = await new Promise<string>(function (resolve, reject) {
		const child = spawn('ffmpeg', ['-version'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let output = ''

		child.stdout.setEncoding('utf8')
		child.stdout.on('data', function (chunk: string) {
			output += chunk
		})

		child.on('error', reject)

		child.on('close', function (code) {
			if (code !== 0) {
				reject(new Error('FFmpeg failed to execute successfully'))
				return
			}

			const match = output.match(/ffmpeg version n?(\d+)\.(\d+)(?:\.(\d+))?/)

			if (!match) {
				reject(new Error('Could not determine FFmpeg version'))
				return
			}

			const detected = [
				Number(match[1]),
				Number(match[2]),
				Number(match[3] ?? 0),
			]

			const isSupported =
				detected[0]! > MIN_VERSION[0]! ||
				(detected[0] === MIN_VERSION[0] &&
					(detected[1]! > MIN_VERSION[1]! ||
						(detected[1] === MIN_VERSION[1] &&
							detected[2]! >= MIN_VERSION[2]!)))

			if (!isSupported) {
				reject(
					new Error(`FFmpeg 4.4.0 or newer is required (found ${match[0]})`),
				)
				return
			}

			resolve(match[0])
		})
	})

	const encoders = await new Promise<string>(function (resolve, reject) {
		const child = spawn('ffmpeg', ['-hide_banner', '-encoders'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let output = ''

		child.stdout.setEncoding('utf8')
		child.stdout.on('data', function (chunk: string) {
			output += chunk
		})

		child.on('error', reject)

		child.on('close', function (code) {
			if (code !== 0) {
				reject(new Error('Could not inspect FFmpeg encoders'))
				return
			}

			resolve(output)
		})
	})

	if (!/^\s*A\S*\s+libmp3lame\s/m.test(encoders)) {
		throw new Error('FFmpeg was found, but the libmp3lame encoder is missing')
	}

	return {version}
}

export async function encodePcmToMp3(
	pcm: Buffer,
	outputPath: string,
	format: PcmFormat,
): Promise<void> {
	const child = spawn(
		'ffmpeg',
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			format.bitsPerSample === 16 ? 's16le' : 's32le',
			'-ar',
			String(format.sampleRate),
			'-ac',
			String(format.channels),
			'-i',
			'pipe:0',
			'-c:a',
			'libmp3lame',
			'-b:a',
			'128k',
			'-f',
			'mp3',
			'pipe:1',
		],
		{
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	)

	let stderr = ''

	child.stderr.setEncoding('utf8')
	child.stderr.on('data', function (chunk: string) {
		stderr += chunk
	})

	const exitPromise = new Promise<number | null>(function (resolve, reject) {
		child.on('error', reject)
		child.on('close', resolve)
	})

	try {
		child.stdin.end(pcm)

		const [, exitCode] = await Promise.all([
			pipeline(child.stdout, createWriteStream(outputPath, {flags: 'wx'})),
			exitPromise,
		])

		if (exitCode !== 0) {
			throw new Error(
				`FFmpeg encoding failed (exit code ${exitCode}): ${stderr.trim()}`,
			)
		}
	} catch (error) {
		child.kill()
		throw error
	}
}
