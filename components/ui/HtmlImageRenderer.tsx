/**
 * components/ui/HtmlImageRenderer.tsx
 *
 * Custom `img` renderer untuk react-native-render-html (dipakai di
 * app/news/[slug].tsx) — komponen bawaan library ini merender <img> pakai
 * Image bawaan React Native (Fresco di Android), yang tidak melakukan
 * downsampling/caching otomatis dan sempat diflag Play Console sebagai
 * "manual bitmap decode" berisiko boros memori. Di sini cuma tahap render
 * akhirnya yang diganti ke expo-image (Glide-backed) — logika hitung
 * dimensi/loading-state tetap dipakai apa adanya dari hook resmi library
 * ini supaya perilaku layout (ukuran, aspect ratio) tidak berubah.
 */

import React, { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  IMGElementContainer,
  useIMGElementProps,
  useIMGElementState,
  type CustomBlockRenderer,
} from 'react-native-render-html';

const HtmlImageRenderer: CustomBlockRenderer = (props) => {
  const imgProps = useIMGElementProps(props);
  const state = useIMGElementState(imgProps);

  const onImageError = useCallback(() => {
    if (state.type === 'success') {
      state.onError(new Error('Gagal memuat gambar'));
    }
  }, [state]);

  let content: React.ReactNode;
  if (state.type === 'success') {
    content = (
      <ExpoImage
        source={state.source}
        style={[state.dimensions, state.imageStyle]}
        contentFit="cover"
        onError={onImageError}
      />
    );
  } else if (state.type === 'loading') {
    content = (
      <View style={[state.dimensions, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="small" />
      </View>
    );
  } else {
    content = <View style={state.dimensions} />;
  }

  return (
    <IMGElementContainer
      testID={imgProps.testID}
      {...imgProps.containerProps}
      style={state.containerStyle}
    >
      {content}
    </IMGElementContainer>
  );
};

export default HtmlImageRenderer;
