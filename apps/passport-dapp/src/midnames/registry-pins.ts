// SHA-256 verifier hashes from the SRI-verified @midnames/sdk@2.1.0 archive.
export const MIDNAMES_REGISTRY_VERIFIERS = Object.freeze({
  add_domain_field: 'f37d167d1465577d7c048cee6e45d8a7d405a8e6e763d933c49e8e7f443ab96f',
  add_multiple_fields: 'd36389bc5eac66b289661b0b393c66a497cf230542ecfe34641254498093b5f2',
  change_field_limit: '0d3ca471eaa520babeca7c152ae225c397d77085e353af96308341e81844469d',
  change_root_enable_subdomains: '2135e7887ccfdb7496be9ea9bdefff75fae3c3ed59a7310dfa6186ffc65d32dd',
  clear_domain_fields: '28c7e1c2114f625a58b313b5bdcd9d385d2e62953098ad5dc959f902803b92f7',
  create_domain: '7bd4b162abd092dac2c56c82e549df08977b4374904508dd8735eb7a5ee22b63',
  lock_payment_config: '5347421d4551d1196a667539d83defb8704558e51b1c8cee92560021c8248f5a',
  lock_target: '193115a178b807da70e7efe713a4f804287f67a4f6ff6a4203c130f46d351047',
  remove_domain_field: 'e75f24d57207ccde97f7a02cdbb4fceab971560fc611120a4ad6111d882fc532',
  transfer_domain: 'd1a03e2243c19ef3639f9208070d74b8c16575752b501fe3b9554a4936d00f59',
  update_domain_default_field: 'ab73037aada66bfe3c036a90bc4c3a12b2cc347ea3080c5f70eeeb8c8b063f91',
  update_payment_config: '93ea6c7d477cad92dc1ef9a5ee9a06d50cac2144afe137b93d528810e6a85572',
  update_target: '6a0107c83d4ce07b1dbd416a7207e44055031ef6beb0fd5280475ce3b13181e3',
});

// Standalone fixture compiled from Midnames v2.1.0 with Compact 0.35.0.
export const STANDALONE_REGISTRY_VERIFIERS = Object.freeze({
  add_domain_field: '3f3219c9abf0668ff2f56958cfc9348c66a56ddd694fcb9634da64c1f5420096',
  add_multiple_fields: '9386dce1213dec2696da80a81a755d8ab77efe133bc9bda0528da5552a59de49',
  change_field_limit: 'a11b0d0425fc0453dbc12f845752845e408a878405314e5a761cd3c5ae8c6149',
  change_root_enable_subdomains: 'a5abf5296f37e882b9480da753b3e6cc79be62889ca407f0c8abf993b78c1fbb',
  clear_domain_fields: 'b68e1bbe96a1fcc2e546e791ace08e6aa81f53bd3f313700f874fbd31622da8d',
  create_domain: '141e6b004707ace4b508a02c4021fec05f9b0c664c9f91917f0adb8643b71191',
  lock_payment_config: '8b9a463d536cf87d9bb466108057b031342f801b7d7524ef082c054d026a50d7',
  lock_target: '0222425b2e6dc411862c4a0bafc48d59e231befd46e86db6153b1a19f975e5bd',
  remove_domain_field: '35528235b84ce8188677d05504bede5427e25e82f1f0b704031ddd1454ffcd38',
  transfer_domain: '8973463762740672eb742b55a12281108b3c467b6133c74d781ca8e74596e6d2',
  update_domain_default_field: '28b61d979ddcd27fbc011683bad70733be1e99a7705c98e447d0e1895d2f9435',
  update_payment_config: '72e29eef34ea2f7ecf3d11e938fd06456d3ec8a0391b91ceb639d4df1408797d',
  update_target: '3b989ba97e6f44c59925ed6164e04284674a820146446c040f6be451aa8a1542',
});

export type MidnamesRegistryProfile = 'midnames-2.1.0' | 'standalone-0.35';

export function registryProfile(
  value: string | undefined,
  networkId: string,
): MidnamesRegistryProfile {
  if (value === undefined || value === 'midnames-2.1.0') return 'midnames-2.1.0';
  if (value === 'standalone-0.35' && networkId === 'undeployed') return value;
  throw new Error('Unsupported Midnames registry profile for this network.');
}
