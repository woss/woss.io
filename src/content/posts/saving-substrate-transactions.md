---
title: 'On saving the TX in substrate'
slug: 'saving-substrate-transactions'
date: 2021-12-15
tags: [substrate, javascript, blockchain]
excerpt: 'On saving the TX in substrate From the docs: Any transaction will emit events, as a bare minimum this will always be either a system.ExtrinsicSuccess or system.ExtrinsicFailed event for the specific transaction. These provide the overall execution result for the transaction, i.e. execution has succeeded or failed.'
description: 'How to save a Substrate transaction and properly detect failures using Polkadot JS events'
published: true
---

## On saving the TX in substrate

[doc](https://polkadot.js.org/api/start/api.rpc.html)

From the docs:

> Any transaction will emit events, as a bare minimum this will always be either a `system.ExtrinsicSuccess` or `system.ExtrinsicFailed` event for the specific transaction. These provide the overall execution result for the transaction, i.e. execution has succeeded or failed.

And

> Be aware that when a transaction status is `isFinalized`, it means it is included, but it may still have failed - for instance if you try to send a larger amount that you have free, the transaction is included in a block, however from a end-user perspective the transaction failed since the transfer did not occur. In these cases a `system.ExtrinsicFailed` event will be available in the events array.

Which means that the event of `isFinalized` will be triggered and you will get the green light, but the TX is failed.

The event structures are only defined in the metadata and they are decoded on the fly. The source of truth as to what the event contains is the Rust code. The `///` comment is the one that defines the error message. The sample code is:

```rust
// The pallet's events
decl_event!(
  pub enum Event<T>
  where
    AccountId = <T as system::Trait>::AccountId,
  {
    /// Event emitted when a proof has been claimed.
    ClaimCreated(AccountId, Vec<u8>),
    /// Event emitted when a claim is revoked by the owner.
    ClaimRevoked(AccountId, Vec<u8>),
    /// Event emitted when a rule is created.
    RuleCreated(AccountId, Vec<u8>),
  }
);
```

There is no specific types for those anyway. It is decorated and injected at runtime once the metadata is retrieved.

Code sample from SensioNetwork:

```ts
async function createTX(
  api: ApiPromise,
  { payload, ruleId }: { ruleId: string; payload: string },
  signer: KeyringPair,
): Promise<void> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    console.log(`\nCreating TX for the ruleId: ${hexToString(ruleId)}`);
    const unSubscribe = await api.tx.poeModule
      .createRule(ruleId, payload)
      .signAndSend(signer, {}, ({ events = [], status, isError }) => {
        console.log(`\rTransaction status:${status.type}`);

        if (status.isInBlock) {
          console.log('\rIncluded at block hash', status.asInBlock.toHex());

          console.log('\nEvents:', events.length);

          events.forEach(({ event, phase }) => {
            const { data, method, section } = event;

            // this is the way to get the failed TX error message.
            const [error] = data;

            // console.log('\r', phase.toString(), `: ${section}.${method}`, data.toString());
            // console.log('\r', phase.toString(), `: ${section}.${method}`);

            if (error.isModule) {
              const { documentation, name, section } = api.registry.findMetaError(error.asModule);
              console.log(documentation, name, section);
              console.log('\rRejecting ...');
              // reject here would make all the other promises to fail

              unSubscribe();
              reject('ExtrinsicFailed');
              // resolve();
            } else {
              console.log('\r', phase.toString(), `: ${section}.${method}`, data.toString());
            }
          });
        } else if (status.isFinalized) {
          console.log('\rFinalized block hash', status.asFinalized.toHex());
          unSubscribe();
          resolve();
        } else if (isError) {
          console.error(status);
        }

        // console.log(
        //   `Rule created for ${ForWhat[r.forWhat]}\n hash: ${createdRuleSimple.toHex()}\n cid: ${hexToString(ruleId)}`,
        // );
      })
      .catch(reject);
  });
}
```

The above code in the real life can produce this:

```bash
Creating TX for the ruleId: bafkzbzaccd4az2tqvpf57p36l5zi6uua7rla
Transaction status:Ready
Transaction status:InBlock
Included at block hash 0x639973f4d215d5ce58aa79b581f167ad54ddfa004b7bef32034a530579a7eeb2

Events: 1
[ ' Rule already exists' ] RuleAlreadyCreated poeModule
Rejecting ...
ExtrinsicFailed
```
