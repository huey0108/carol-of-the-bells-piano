// Web MIDI input (Chrome/Edge/Firefox desktop + Android Chrome; not available in Safari/iOS).
type NoteCb = (m: number, vel: number) => void;
type DevCb = (names: string[]) => void;

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export async function connectMidi(onNote: NoteCb, onDevices: DevCb): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!midiSupported()) return { ok: false, error: 'Web MIDI niedostępne w tej przeglądarce' };
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => {
      const names: string[] = [];
      access.inputs.forEach(inp => {
        names.push(inp.name || 'MIDI');
        inp.onmidimessage = (ev: MIDIMessageEvent) => {
          const d = ev.data; if (!d || d.length < 3) return;
          const cmd = d[0] & 0xf0;
          if (cmd === 0x90 && d[2] > 0) onNote(d[1], d[2] / 127);
        };
      });
      onDevices(names);
    };
    access.onstatechange = bind;
    bind();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'odmowa dostępu do MIDI: ' + (e instanceof Error ? e.message : String(e)) };
  }
}
