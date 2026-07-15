<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Button } from '$lib/components/ui/button';
    import * as Select from '$lib/components/ui/select';
    import { Slider } from '$lib/components/ui/slider';
    import { settings } from '$lib/logic/settings';
    import { i18n } from '$lib/i18n.svelte';
    import { ListWaypointItem } from '$lib/components/file-list/file-list';
    import Help from '$lib/components/Help.svelte';
    import { onDestroy, onMount, untrack } from 'svelte';
    import { getURLForLanguage } from '$lib/utils';
    import { MapPin, CircleX, Save, Circle, ImageUp } from '@lucide/svelte';
    import { getSymbolKey, symbols } from '$lib/assets/symbols';
    import { selection } from '$lib/logic/selection';
    import { selectedWaypoint } from './waypoint';
    import { fileActions } from '$lib/logic/file-actions';
    import { map } from '$lib/components/map/map';
    import { mapCursor, MapCursorState } from '$lib/logic/map-cursor';
    import maplibregl from 'maplibre-gl';
    import {
        getSvgForSymbol,
        getMarkerStyle,
        getMarkerColor,
        getMarkerSize,
        getCustomIconFromLinks,
        encodeMarkerStyle,
        CUSTOM_ICON_LINK_TYPE,
        type MarkerStyle,
    } from '$lib/components/map/gpx-layer/gpx-layer';

    let props: {
        class?: string;
    } = $props();

    const { markerIconSize } = settings;

    let name = $state('');
    let description = $state('');
    let link = $state('');
    let sym = $state('');
    let longitude = $state(0);
    let latitude = $state(0);

    let markerStyle = $state<MarkerStyle>('pin');
    let markerColorValue = $state<string | undefined>(undefined);
    let markerSize = $state<number>(1);
    let customIconDataUri = $state<string | undefined>(undefined);
    let customIconPreviewUrl = $state<string | undefined>(undefined);
    let fileInputEl: HTMLInputElement | undefined = $state(undefined);

    let symbolKey = $derived(getSymbolKey(sym));
    let canCreate = $derived($selection.size > 0);

    let sortedSymbols = $derived(
        Object.entries(symbols).sort((a, b) => {
            return i18n
                ._(`gpx.symbol.${a[0]}`)
                .localeCompare(i18n._(`gpx.symbol.${b[0]}`), i18n.lang);
        })
    );

    let marker: maplibregl.Marker | null = null;

    function reset() {
        if ($selectedWaypoint) {
            selectedWaypoint.reset();
        } else {
            name = '';
            description = '';
            link = '';
            sym = '';
            longitude = 0;
            latitude = 0;
            markerStyle = 'pin';
            markerColorValue = undefined;
            markerSize = $markerIconSize;
            customIconDataUri = undefined;
            customIconPreviewUrl = undefined;
        }
    }

    $effect(() => {
        if ($selectedWaypoint) {
            const wpt = $selectedWaypoint[0];
            untrack(() => {
                name = wpt.name ?? '';
                description = wpt.desc ?? '';
                if (wpt.cmt !== undefined && wpt.cmt !== wpt.desc) {
                    description += '\n\n' + wpt.cmt;
                }
                markerStyle = getMarkerStyle(wpt.type);
                markerColorValue = getMarkerColor(wpt.type);
                markerSize = getMarkerSize(wpt.type) ?? $markerIconSize;
                const savedIcon = getCustomIconFromLinks(wpt.link);
                if (savedIcon) {
                    customIconDataUri = savedIcon;
                    customIconPreviewUrl = savedIcon;
                    link = '';
                } else {
                    customIconDataUri = undefined;
                    customIconPreviewUrl = undefined;
                    link = wpt.link?.attributes?.href ?? '';
                }
                sym = wpt.sym ?? '';
                longitude = parseFloat(wpt.getLongitude().toFixed(6));
                latitude = parseFloat(wpt.getLatitude().toFixed(6));
            });
        } else {
            untrack(reset);
        }
    });

    async function handleIconUpload(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        if (file.type === 'image/svg+xml') {
            const text = await file.text();
            customIconDataUri =
                'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
            customIconPreviewUrl = URL.createObjectURL(file);
        } else {
            customIconDataUri = await new Promise<string>((res) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result as string);
                reader.readAsDataURL(file);
            });
            customIconPreviewUrl = customIconDataUri;
        }
    }

    function clearCustomIcon() {
        customIconDataUri = undefined;
        customIconPreviewUrl = undefined;
        if (fileInputEl) fileInputEl.value = '';
    }

    function createOrUpdateWaypoint() {
        if (typeof latitude === 'string') latitude = parseFloat(latitude);
        if (typeof longitude === 'string') longitude = parseFloat(longitude);
        latitude = parseFloat(latitude.toFixed(6));
        longitude = parseFloat(longitude.toFixed(6));

        const gpxLink =
            markerStyle === 'custom' && customIconDataUri
                ? {
                      attributes: { href: customIconDataUri },
                      type: CUSTOM_ICON_LINK_TYPE,
                  }
                : link.length > 0
                  ? { attributes: { href: link } }
                  : undefined;

        fileActions.addOrUpdateWaypoint(
            {
                attributes: { lat: latitude, lon: longitude },
                name: name.length > 0 ? name : undefined,
                desc: description.length > 0 ? description : undefined,
                cmt: description.length > 0 ? description : undefined,
                type: encodeMarkerStyle(markerStyle, markerColorValue, markerSize),
                link: gpxLink,
                sym: sym.length > 0 ? sym : undefined,
            },
            selectedWaypoint.wpt && selectedWaypoint.fileId
                ? new ListWaypointItem(selectedWaypoint.fileId, selectedWaypoint.wpt._data.index)
                : undefined
        );

        reset();
    }

    function setCoordinates(e: any) {
        latitude = e.lngLat.lat.toFixed(6);
        longitude = e.lngLat.lng.toFixed(6);
    }

    $effect(() => {
        if ($selectedWaypoint) {
            if (marker) { marker.remove(); marker = null; }
        } else if (latitude != 0 || longitude != 0) {
            const svg = getSvgForSymbol(symbolKey, undefined, markerStyle, customIconDataUri);
            const previewSize = Math.round(100 * markerSize);
            if ($map) {
                if (marker) {
                    const el = marker.getElement();
                    el.innerHTML = svg;
                    el.style.width = `${previewSize}px`;
                    el.style.height = `${previewSize}px`;
                    marker.setLngLat([longitude, latitude]);
                } else {
                    let element = document.createElement('div');
                    element.style.width = `${previewSize}px`;
                    element.style.height = `${previewSize}px`;
                    element.innerHTML = svg;
                    marker = new maplibregl.Marker({ element, anchor: 'bottom' })
                        .setLngLat([longitude, latitude])
                        .addTo($map);
                }
            }
        } else {
            if (marker) { marker.remove(); marker = null; }
        }
    });

    onMount(() => {
        if ($map) {
            $map.on('click', setCoordinates);
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, true);
        }
        if (!$selectedWaypoint) {
            markerSize = $markerIconSize;
        }
    });

    onDestroy(() => {
        if ($map) {
            $map.off('click', setCoordinates);
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, false);
        }
        if (marker) { marker.remove(); marker = null; }
    });
</script>

<div class="flex flex-col gap-3 w-full max-w-96 {props.class ?? ''}">
    <fieldset class="flex flex-col gap-1.5">
        <div class="flex flex-col gap-1">
            <Label for="name">{i18n._('menu.metadata.name')}</Label>
            <Input
                bind:value={name}
                id="name"
                class="font-semibold"
                disabled={!canCreate && !$selectedWaypoint}
            />
        </div>

        <div class="flex flex-col gap-1">
            <Label for="description">{i18n._('menu.metadata.description')}</Label>
            <Textarea
                bind:value={description}
                id="description"
                disabled={!canCreate && !$selectedWaypoint}
                class="min-h-8 h-8 py-1 px-3 text-sm"
            />
        </div>

        {#if markerStyle !== 'custom'}
            <div class="flex flex-col gap-1">
                <Label for="symbol">{i18n._('toolbar.waypoint.icon')}</Label>
                <Select.Root bind:value={sym} type="single">
                    <Select.Trigger
                        id="symbol"
                        class="w-full"
                        disabled={!canCreate && !$selectedWaypoint}
                    >
                        <span class="flex flex-row gap-1.5 items-center">
                            {#if symbolKey}
                                {#if symbols[symbolKey].icon}
                                    {@const Component = symbols[symbolKey].icon}
                                    <Component size="14" />
                                {/if}
                                {i18n._(`gpx.symbol.${symbolKey}`)}
                            {:else}
                                {sym}
                            {/if}
                        </span>
                    </Select.Trigger>
                    <Select.Content class="max-h-60">
                        {#each sortedSymbols as [key, symbol]}
                            <Select.Item value={symbol.value}>
                                <span>
                                    {#if symbol.icon}
                                        {@const Component = symbol.icon}
                                        <Component size="14" class="inline-block align-sub" />
                                    {:else}
                                        <span class="w-4 inline-block"></span>
                                    {/if}
                                    {i18n._(`gpx.symbol.${key}`)}
                                </span>
                            </Select.Item>
                        {/each}
                    </Select.Content>
                </Select.Root>
            </div>
        {/if}

        <div class="flex flex-col gap-1">
            <Label>Marker style</Label>
            <div class="flex flex-row gap-1.5">
                <Button
                    variant={markerStyle === 'pin' ? 'default' : 'outline'}
                    size="sm"
                    class="flex-1 gap-1"
                    disabled={!canCreate && !$selectedWaypoint}
                    onclick={() => { markerStyle = 'pin'; clearCustomIcon(); }}
                >
                    <MapPin size="14" />
                    Pin
                </Button>
                <Button
                    variant={markerStyle === 'circle' ? 'default' : 'outline'}
                    size="sm"
                    class="flex-1 gap-1"
                    disabled={!canCreate && !$selectedWaypoint}
                    onclick={() => { markerStyle = 'circle'; clearCustomIcon(); }}
                >
                    <Circle size="14" />
                    Circle
                </Button>
                <Button
                    variant={markerStyle === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    class="flex-1 gap-1"
                    disabled={!canCreate && !$selectedWaypoint}
                    onclick={() => (markerStyle = 'custom')}
                >
                    <ImageUp size="14" />
                    Image
                </Button>
            </div>
        </div>

        <div class="flex flex-col gap-1">
            <Label class="flex flex-row justify-between items-center">
                <span>{i18n._('toolbar.waypoint.marker_size')}</span>
                <span class="text-xs text-muted-foreground tabular-nums">
                    {Math.round(markerSize * 100)}%
                </span>
            </Label>
            <div class="px-1">
                <Slider
                    bind:value={markerSize}
                    type="single"
                    min={0.15}
                    max={1}
                    step={0.05}
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
        </div>

        {#if markerStyle === 'custom'}
            <div class="flex flex-col gap-1">
                <Label for="customIcon">Upload icon (SVG or PNG/JPEG)</Label>
                <div class="flex flex-row gap-1.5 items-center">
                    <input
                        bind:this={fileInputEl}
                        id="customIcon"
                        type="file"
                        accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
                        class="text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs grow"
                        onchange={handleIconUpload}
                        disabled={!canCreate && !$selectedWaypoint}
                    />
                    {#if customIconPreviewUrl}
                        <img
                            src={customIconPreviewUrl}
                            class="w-8 h-8 object-contain rounded border border-border shrink-0"
                            alt="icon preview"
                        />
                    {/if}
                </div>
                {#if !customIconDataUri}
                    <p class="text-xs text-muted-foreground">
                        No icon uploaded — the default pin will be used.
                    </p>
                {/if}
            </div>
        {/if}

        {#if markerStyle !== 'custom'}
            <div class="flex flex-col gap-1">
                <Label for="link">{i18n._('toolbar.waypoint.link')}</Label>
                <Input
                    bind:value={link}
                    id="link"
                    class="h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
        {/if}

        <div class="flex flex-row gap-1.5">
            <div class="grow flex flex-col gap-1">
                <Label for="latitude">{i18n._('toolbar.waypoint.latitude')}</Label>
                <Input
                    bind:value={latitude}
                    type="number"
                    id="latitude"
                    step={1e-6}
                    min={-90}
                    max={90}
                    class="text-xs h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
            <div class="grow flex flex-col gap-1">
                <Label for="longitude">{i18n._('toolbar.waypoint.longitude')}</Label>
                <Input
                    bind:value={longitude}
                    type="number"
                    id="longitude"
                    step={1e-6}
                    min={-180}
                    max={180}
                    class="text-xs h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
        </div>
    </fieldset>

    <div class="flex flex-row gap-1.5 items-center">
        <Button
            variant="outline"
            disabled={!canCreate && !$selectedWaypoint}
            class="grow shrink h-fit min-h-8 whitespace-normal py-1"
            onclick={createOrUpdateWaypoint}
        >
            {#if $selectedWaypoint}
                <Save size="16" class="shrink-0" />
                {i18n._('menu.metadata.save')}
            {:else}
                <MapPin size="16" class="shrink-0" />
                {i18n._('toolbar.waypoint.create')}
            {/if}
        </Button>
        <Button variant="outline" size="icon" onclick={reset}>
            <CircleX size="16" />
        </Button>
    </div>

    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/poi')}>
        {#if $selectedWaypoint || canCreate}
            {i18n._('toolbar.waypoint.help')}
        {:else}
            {i18n._('toolbar.waypoint.help_no_selection')}
        {/if}
    </Help>
</div>