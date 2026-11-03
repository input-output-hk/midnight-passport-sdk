// A timed-out async acquisition can resolve after cleanup starts. It must never escape ownership.
import { consumerSha256 } from '../consumer-inputs.mjs';
import { browserDeadline } from './browser-deadline.mjs';
/** @typedef {{name:string,status:'not-created'|'pending'|'open'|'closing'|'closed'|'close-failed'|'acquisition-failed',close?:()=>Promise<unknown>,closing?:Promise<void>,errorSha256?:string}} Resource */
export class BrowserOwnership {
  /** @param {string[]} names */
  constructor(names) {
    this.settled = false;
    /** @type {Resource[]} */ this.resources = names.map((name) => ({
      name,
      status: 'not-created',
    }));
  }
  guard() {
    if (this.settled) throw Error('Browser qualification has settled');
  }
  /** @template T @param {string} name @param {()=>Promise<T>} acquire @param {(value:T)=>Promise<unknown>} close */
  async acquire(name, acquire, close) {
    this.guard();
    const resource = this.resources.find((r) => r.name === name);
    if (!resource || resource.status !== 'not-created')
      throw Error('Unexpected resource acquisition');
    resource.status = 'pending';
    let value;
    try {
      value = await acquire();
    } catch (error) {
      resource.status = 'acquisition-failed';
      throw error;
    }
    resource.close = () => close(value);
    resource.status = 'open';
    if (this.settled) {
      await this.closeResource(resource);
      this.guard();
    }
    return value;
  }
  /** @param {Resource} resource @param {number} [timeoutMs] */
  async closeResource(resource, timeoutMs = 5000) {
    if (resource.status === 'closing') return resource.closing;
    if (resource.status !== 'open' || !resource.close) return;
    resource.status = 'closing';
    const close = resource.close;
    resource.closing = (async () => {
      try {
        await browserDeadline(close, timeoutMs);
        resource.status = 'closed';
      } catch (error) {
        resource.status = 'close-failed';
        resource.errorSha256 = consumerSha256(String(error));
      }
    })();
    await resource.closing;
  }

  /** @param {number} [timeoutMs] */
  async cleanup(timeoutMs = 5000) {
    this.settled = true;
    for (const resource of this.resources) await this.closeResource(resource, timeoutMs);
    return this.resources.map(({ name, status, errorSha256 }) => ({
      name,
      status,
      closed:
        status === 'closed'
          ? true
          : status === 'not-created' || status === 'acquisition-failed'
            ? null
            : false,
      errorSha256,
    }));
  }
}
