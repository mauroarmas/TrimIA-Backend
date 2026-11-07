"""Genera voz española MP3 decodificable y comprobantes claramente ficticios."""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import wave

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tools-dir', required=True)
    parser.add_argument('--output-root', default='storage')
    args = parser.parse_args()
    script_root = Path(__file__).resolve().parent
    data = json.loads(subprocess.check_output([
        'node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))',
        str(script_root / 'fixtures/qa-cycle2.cjs'),
    ], text=True))
    # Las funciones no se serializan; los IDs de los registros ya están resueltos.
    root = Path(args.output_root).resolve()
    audio_dir = root / 'audio'
    proof_dir = root / 'payment-proofs'
    metadata_dir = root / 'qa-cycle2'
    for directory in (audio_dir, proof_dir, metadata_dir):
        directory.mkdir(parents=True, exist_ok=True)
    espeak = Path(args.tools_dir).resolve() / 'usr/bin/espeak-ng'
    lame = Path(args.tools_dir).resolve() / 'usr/bin/lame'
    metadata = {}
    for module in data['modules']:
        for pill in module['pills']:
            target = audio_dir / f"{pill['id']}.mp3"
            with tempfile.TemporaryDirectory(prefix='trimia-qa-voz-') as tmp:
                tmp = Path(tmp)
                segments = []
                params = None
                for index, line in enumerate(pill['audioScript']['dialogue']):
                    segment = tmp / f'{index}.wav'
                    subprocess.run([
                        str(espeak), '-v', 'es-419', '-s', '155', '-p',
                        '43' if line['speaker'] == 'SPEAKER_1' else '65',
                        '-w', str(segment), '--stdin',
                    ], input=line['text'], text=True, check=True, capture_output=True)
                    with wave.open(str(segment), 'rb') as stream:
                        if params is None:
                            params = stream.getparams()
                        assert (stream.getnchannels(), stream.getsampwidth(), stream.getframerate()) == (1, 2, params.framerate)
                        segments.append(stream.readframes(stream.getnframes()))
                        segments.append(b'\0' * (int(params.framerate * .2) * 2))
                combined = tmp / 'combined.wav'
                with wave.open(str(combined), 'wb') as stream:
                    stream.setparams(params)
                    stream.writeframes(b''.join(segments))
                staging = tmp / 'audio.mp3'
                subprocess.run([str(lame), '--silent', '-b', '64', str(combined), str(staging)], check=True)
                decoded = tmp / 'decoded.wav'
                subprocess.run([str(lame), '--silent', '--decode', str(staging), str(decoded)], check=True)
                with wave.open(str(decoded), 'rb') as stream:
                    duration = stream.getnframes() / stream.getframerate()
                    samples = array.array('h', stream.readframes(stream.getnframes()))
                    assert duration > 30, f'Audio demasiado corto: {pill["title"]}'
                    assert max(abs(value) for value in samples) > 1000, 'No hay voz audible'
                audio_bytes = staging.read_bytes()
                digest = hashlib.sha256(audio_bytes).hexdigest()
                if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                    raise RuntimeError(f'Ya existe otro audio en {target}; no se sobrescribió.')
                if not target.exists():
                    target.write_bytes(audio_bytes)
                metadata[pill['id']] = {
                    'durationSeconds': math.ceil(duration), 'size': len(audio_bytes),
                    'sha256': digest, 'codec': 'MP3', 'voice': 'espeak-ng es-419',
                }
                print(f"Audio verificado: {pill['title']} ({math.ceil(duration)} s)")

    font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    font = ImageFont.truetype(font_path, 26)
    title_font = ImageFont.truetype(font_path, 36)
    for key, amount, detail in [
        ('valido', '120.000,00', 'Pendiente de revisión'),
        ('cero', '0,00', 'Debe impedir aceptación e impacto'),
        ('insuficiente', '110.000,00', 'Cuota simulada de $120.000,00'),
        ('aceptado', '120.000,00', 'Impacto pendiente: estado simulado'),
        ('rechazado', '120.000,00', 'Rechazado: estado inicial simulado'),
        ('manual', '120.000,00', 'Manejo manual: estado inicial simulado'),
    ]:
        target = proof_dir / f'qa-ciclo2-{key}.png'
        if target.exists():
            continue
        image = Image.new('RGB', (1100, 680), '#f6f8fb')
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 1080, 660), outline='#b22222', width=6)
        lines = [
            'COMPROBANTE SIMULADO - QA CICLO 2',
            'SIN VALIDEZ FINANCIERA',
            'Emisor: Cliente ficticio de pruebas',
            'Destino: Entorno de validación TrimIA',
            f'Importe ficticio: $ {amount}',
            'Banco: Banco QA (ficticio)',
            f'Operación de prueba: QA-C2-{key.upper()}',
            detail,
            'No acredita un pago. No contiene datos bancarios reales.',
        ]
        for index, text in enumerate(lines):
            draw.text((45, 45 + index * 64), text, fill='#9a1717' if index < 2 else '#1f2937', font=title_font if index == 1 else font)
        image.save(target)
    (metadata_dir / 'audio-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    print(f'Metadata de {len(metadata)} audios guardada en {metadata_dir / "audio-metadata.json"}')


if __name__ == '__main__':
    main()
