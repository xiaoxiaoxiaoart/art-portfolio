"""Subset Sarasa fonts to only include characters used on the site.
Run this after adding new text content that may contain new characters."""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter

BASE = os.path.dirname(os.path.abspath(__file__))

# Collect all characters from dist, src, and content
chars = set()
for root, dirs, files in os.walk(os.path.join(BASE, 'dist')):
    for f in files:
        if f.endswith('.html'):
            with open(os.path.join(root, f), 'r') as fh:
                chars.update(fh.read())
for root, dirs, files in os.walk(os.path.join(BASE, 'src/content')):
    for f in files:
        if f.endswith('.md'):
            with open(os.path.join(root, f), 'r') as fh:
                chars.update(fh.read())
for root, dirs, files in os.walk(os.path.join(BASE, 'src')):
    for f in files:
        if f.endswith(('.astro', '.ts')):
            with open(os.path.join(root, f), 'r') as fh:
                chars.update(fh.read())

chars = {c for c in chars if ord(c) >= 32 and c not in '\n\r'}
unicodes = sorted(ord(c) for c in chars)
print(f'Unique characters: {len(chars)}')

fonts_dir = os.path.join(BASE, 'public', 'fonts')
for name in ['sarasafixedslabsc-light', 'sarasafixedslabsc-lightitalic']:
    path = os.path.join(fonts_dir, f'{name}.woff2')
    old = os.path.getsize(path)
    font = TTFont(path)
    sub = Subsetter()
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(path)
    font.close()
    new = os.path.getsize(path)
    print(f'{name}: {old//1024}KB -> {new//1024}KB')
print('Done!')
