import {
  parseYoutubeUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from '../../../../src/modules/catalog/youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeUrl', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch/?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `   https://youtu.be/${ID}  `,
  ])('reads the video id from %s', (url) => {
    expect(parseYoutubeUrl(url)).toBe(ID);
  });

  it('keeps an id with - and _ exactly', () => {
    expect(parseYoutubeUrl('https://youtu.be/a-B_c-D_e-F')).toBe('a-B_c-D_e-F');
  });

  it.each([
    ['a bare id', ID],
    ['an empty string', ''],
    ['spaces only', '   '],
    ['another video site', 'https://vimeo.com/123456'],
    ['a look-alike host', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['another host with a watch path', `https://evil.example/watch?v=${ID}`],
    ['a subdomain youtu.be does not have', `https://www.youtu.be/${ID}`],
    ['a short id', 'https://www.youtube.com/watch?v=short'],
    ['a 12-character id', `https://www.youtube.com/watch?v=${ID}x`],
    ['an id with !', 'https://www.youtube.com/watch?v=dQw4w9WgXc!'],
    ['a playlist', 'https://www.youtube.com/watch?list=PL123'],
    ['a channel', 'https://www.youtube.com/@channel'],
    ['youtu.be without an id', 'https://youtu.be/'],
    ['youtu.be with a deeper path', `https://youtu.be/${ID}/extra`],
    ['a shorts link without an id', 'https://www.youtube.com/shorts/'],
    ['a watch link on the nocookie host', `https://www.youtube-nocookie.com/watch?v=${ID}`],
    ['shorts on music.youtube.com', `https://music.youtube.com/shorts/${ID}`],
    ['user info', `https://user:pass@www.youtube.com/watch?v=${ID}`],
    ['a port', `https://www.youtube.com:8443/watch?v=${ID}`],
    ['another scheme', `ftp://youtu.be/${ID}`],
    ['javascript', 'javascript:alert(1)'],
    ['not a URL', 'youtube.com/watch?v=dQw4w9WgXcQ'],
    ['a URL over 2,048 characters', `https://www.youtube.com/watch?v=${ID}&x=${'a'.repeat(2020)}`],
  ])('refuses %s', (_label, url) => {
    expect(parseYoutubeUrl(url)).toBeNull();
  });
});

describe('the derived URLs', () => {
  it('builds the privacy-enhanced embed, the thumbnail and the watch link from the id', () => {
    expect(youtubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
    expect(youtubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
