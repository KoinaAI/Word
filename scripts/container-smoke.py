#!/usr/bin/env python3
"""Focused release-image check: guest session, sprint transitions, admin gate, and SPA."""
import argparse, http.cookiejar, json, urllib.request, uuid
p=argparse.ArgumentParser();p.add_argument('base');args=p.parse_args()
base=args.base.rstrip('/')
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path,body=None):
 req=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','Origin':base})
 return json.load(opener.open(req,timeout=10))
assert request('/health')['status']=='ok'
user=request('/auth/guest',{});assert user['guest']
books=request('/books');assert len(books)>=6
study=request(f'/study?bookId={books[0]["id"]}&mode=sprint');assert len(study['words'])>=3
first,second,third=study['words'][:3]
def answer(word,value,event=None):return request('/study/answer',{'wordId':word['id'],'mode':'sprint','answer':value,'eventId':event or str(uuid.uuid4())})
answer(first,'unknown');answer(second,'unsure-known');event=str(uuid.uuid4());answer(third,'known',event);answer(third,'known',event)
state=request(f'/books/{books[0]["id"]}');words={w['id']:w for w in state['words']}
assert words[first['id']]['status']=='new'
assert words[second['id']]['reinforce'] and words[second['id']]['status']!='mastered'
assert words[third['id']]['status']=='mastered'
stats=request('/stats');assert stats['today']==3 and stats['reinforce']==1
try:request('/admin/stats');raise AssertionError('guest accessed admin')
except urllib.error.HTTPError as e:assert e.code==403
assert '<div id="root">' in opener.open(base+'/books/1').read().decode()
print('PASS: health, session, seeded books, sprint transitions, idempotency, admin gate, SPA fallback')
