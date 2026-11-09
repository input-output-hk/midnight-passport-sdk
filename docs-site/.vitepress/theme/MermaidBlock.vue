<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

const props = defineProps<{ encoded: string }>();
const host = ref<HTMLElement | null>(null);
const failure = ref('');
let sequence = 0;

async function draw() {
  if (!host.value) return;
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
    const { svg } = await mermaid.render(
      `passport-diagram-${sequence++}`,
      decodeURIComponent(props.encoded),
    );
    host.value.innerHTML = svg;
    failure.value = '';
  } catch {
    failure.value = 'Diagram could not render. Read the explanation below it.';
  }
}

onMounted(draw);
watch(() => props.encoded, draw);
</script>

<template>
  <figure class="passport-diagram" role="img" aria-label="Diagram described in the following text">
    <div ref="host" />
    <figcaption v-if="failure">{{ failure }}</figcaption>
  </figure>
</template>
