import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ibmPlexSansRegular, ibmPlexSansBold } from './font';

export async function renderOgImage(title: string, description?: string): Promise<Uint8Array> {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0f0f0f',
          color: '#f0f0f0',
          fontFamily: 'IBM Plex Sans Variable',
          padding: '60px 80px',
          position: 'relative',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                top: 40,
                left: 60,
                fontSize: 18,
                fontWeight: 700,
                color: '#666',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              },
              children: 'woss.io',
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.2,
                textAlign: 'center',
                marginBottom: description ? 24 : 0,
                maxWidth: 960,
              },
              children: title,
            },
          },
          ...(description
            ? [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: 28,
                      fontWeight: 400,
                      color: '#999',
                      lineHeight: 1.4,
                      textAlign: 'center',
                      maxWidth: 800,
                    },
                    children: description,
                  },
                },
              ]
            : []),
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'IBM Plex Sans Variable',
          data: ibmPlexSansRegular,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'IBM Plex Sans Variable',
          data: ibmPlexSansBold,
          weight: 700,
          style: 'normal',
        },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });

  const pngBuffer = resvg.render().asPng();
  return new Uint8Array(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);
}
