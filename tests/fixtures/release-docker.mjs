// Stateful Docker simulation: side effects can precede a lost CLI reply.
/** @typedef {{Id:string,Name:string,Image:string,CreatedAt:string,Labels:Record<string,string>,Config:{Labels:Record<string,string>},HostConfig:{AutoRemove:boolean},State:{Running:boolean,Status:string,ExitCode:number,StartedAt:string},Containers:Record<string,unknown>}} FakeResource */
export class FakeDocker {
  /** @type {Map<string,FakeResource>} */ rows = new Map();
  /** @type {string[][]} */ calls = [];
  fault = '';
  late = false;
  lateStart = false;
  starts = 0;
  /** @type {(()=>void)|undefined} */ pendingEffect;
  /** @type {import('../../scripts/release/resources.mjs').Docker} */
  run = (args) => {
    this.calls.push([...args]);
    const kind = ['volume', 'network'].includes(args[0] ?? '') ? args[0] : 'container';
    const action = kind === 'container' ? args[0] : args[1];
    if (action === 'inspect') {
      if (this.fault === 'inspect') throw Error('Docker inspection unavailable');
      const key = args.at(-1),
        row = [...this.rows.values()].find(
          (value) => value.Id === key || value.Name.replace(/^\//, '') === key,
        );
      return row
        ? { stdout: JSON.stringify([row]), stderr: '', status: 0 }
        : { stdout: '[]', stderr: `Error: No such ${kind}: ${key}`, status: 1 };
    }
    if (action === 'create') {
      const name = kind === 'container' ? args[args.indexOf('--name') + 1] : args.at(-1);
      if (!name) throw Error('Missing fake name');
      const labels = Object.fromEntries(
        args.flatMap((value, at) => (value === '--label' ? [String(args[at + 1]).split('=')] : [])),
      );
      const id = kind === 'volume' ? name : String(this.rows.size + 1).padStart(64, '0');
      const image = args.find((value) => /^sha256:[a-f0-9]{64}$/.test(value)) ?? '';
      const row = {
        Id: id,
        Name: kind === 'container' ? '/' + name : name,
        Image: image,
        CreatedAt: '2026-11-10T00:00:00Z',
        Labels: labels,
        Config: { Labels: labels },
        HostConfig: { AutoRemove: false },
        State: {
          Running: false,
          Status: 'created',
          ExitCode: 0,
          StartedAt: '0001-01-01T00:00:00Z',
        },
        Containers: {},
      };
      const effect = () => this.rows.set(name, row);
      if (this.late) {
        this.pendingEffect = effect;
        throw Error('Create still pending');
      }
      effect();
      if (this.fault === 'create') {
        this.fault = '';
        throw Error('Lost create reply');
      }
      return { stdout: id, stderr: '', status: 0 };
    }
    const row = [...this.rows.values()].find((value) => value.Id === args.at(-1));
    if (!row) throw Error('Unowned fake resource');
    if (action === 'start') {
      const effect = () => {
        row.State.Running = true;
        row.State.Status = 'running';
        row.State.StartedAt = `2026-11-10T00:00:00.${String(++this.starts).padStart(9, '0')}Z`;
      };
      if (this.lateStart) {
        this.pendingEffect = effect;
        throw Error('Start still pending');
      }
      effect();
      if (this.fault === 'start') {
        this.fault = '';
        throw Error('Lost start reply');
      }
      if (args.includes('--attach')) {
        row.State.Running = false;
        row.State.Status = 'exited';
      }
    } else if (action === 'stop') {
      if (this.fault === 'stop') throw Error('Stop unavailable');
      row.State.Running = false;
      row.State.Status = 'exited';
    } else throw Error('Unsupported fake command');
    return { stdout: '', stderr: '', status: 0 };
  };
}
