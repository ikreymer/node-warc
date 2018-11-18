import test from 'ava'
import uuid from 'uuid/v4'
import fs from 'fs-extra'
import { fakeResponse } from './helpers/filePaths'
import restore from './helpers/warcWriterBaseMonkeyPatches'
import WARCWriterBase from '../lib/writers/warcWriterBase'

const crlfRe = /\r\n/g
const idRe = /<urn:uuid:[0-9a-z]+-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+>/
const dateRe = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z/

const fakeReqResHttpData = {
  targetURI: 'http://stringjs.com/',
  reqData: {
    headers:
      'GET / HTTP/1.1\r\n' +
      'Host: stringjs.com\r\n' +
      'Connection: keep-alive\r\n' +
      'Upgrade-Insecure-Requests: 1\r\n' +
      'X-DevTools-Request-Id: 12704.1\r\n' +
      'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Electron/1.7.4 Safari/537.36\r\n' +
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8\r\n' +
      'Accept-Encoding: gzip, deflate\r\n' +
      'Accept-Language: en-US\r\n',
    data: undefined
  },
  resData: {
    headers:
      'HTTP/1.1 200 OK\r\n' +
      'Server: GitHub.com\r\n' +
      'Date: Sun, 16 Jul 2017 05:31:28 GMT\r\n' +
      'Content-Type: text/html; charset=utf-8\r\n' +
      'Transfer-Encoding: chunked\r\n' +
      'Last-Modified: Mon, 22 Sep 2014 14:44:55 GMT\r\n' +
      'Access-Control-Allow-Origin: *\r\n' +
      'Expires: Sun, 16 Jul 2017 05:41:28 GMT\r\n' +
      'Cache-Control: max-age=600\r\n' +
      'X-GitHub-Request-Id: AE92:0456:5576F1:80DBF9:596AFA30\r\n'
  }
}

function parseWrittenInfoMdataRecord (bufferString) {
  const parts = bufferString.split('\r\n')
  let i = 0
  const parsed = {
    WARC: parts.shift().split('/')[1]
  }
  for (; i < parts.length; ++i) {
    let part = parts[i]
    if (part) {
      let sep = part.indexOf(': ')
      parsed[part.substring(0, sep)] = part.substring(sep + 2)
    }
  }
  return parsed
}

function parseWrittenRequestRecord (bufferString) {
  const parts = bufferString.split('\r\n')
  const parsed = {
    WARC: parts.shift().split('/')[1]
  }
  let part = parts.shift()
  while (part) {
    let sep = part.indexOf(': ')
    parsed[part.substring(0, sep)] = part.substring(sep + 2)
    part = parts.shift()
  }
  const http = []
  part = parts.shift()
  while (part) {
    http.push(`${part}\r\n`)
    part = parts.shift()
  }
  parsed.http = http.join('')
  return parsed
}

function parseWrittenResponseRecord (bufferString) {
  const parts = bufferString.split('\r\n')
  const parsed = {
    WARC: parts.shift().split('/')[1]
  }
  while (true) {
    let part = parts.shift()
    if (part) {
      let sep = part.indexOf(': ')
      parsed[part.substring(0, sep)] = part.substring(sep + 2)
    } else {
      break
    }
  }
  const http = []
  let part = parts.shift()
  while (part) {
    http.push(`${part}\r\n`)
    part = parts.shift()
  }
  parsed.http = http.join('')
  const body = []
  part = parts.shift()
  while (part) {
    body.push(`${part}`)
    part = parts.shift()
  }
  parsed.body = body.join('')
  return parsed
}

test.after.always(t => {
  restore()
})

test.beforeEach(t => {
  t.context.writer = new WARCWriterBase()
})

test.afterEach(t => {
  t.context.writer = null
})

test('initWARC should only use the default options when no options or env variables are used', t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const { path, options } = writer._warcOutStream
  t.is(
    path,
    'dummy.warc',
    'the path WARCWriterBase should have used is dummy.warc'
  )
  t.deepEqual(
    options,
    { encoding: 'utf8' },
    'WARCWriterBase should have used the default opts'
  )
  t.deepEqual(
    writer.opts,
    { appending: false, gzip: false },
    'WARCWriterBase when no options are supplied should not set appending or gzip to true'
  )
})

test('initWARC should init the warc in appending mode when the options state appending', t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc', { appending: true })
  const { path, options } = writer._warcOutStream
  t.is(
    path,
    'dummy.warc',
    'the path WARCWriterBase should have used is dummy.warc'
  )
  t.deepEqual(
    options,
    { encoding: 'utf8', flags: 'a' },
    'WARCWriterBase should have used the default opts'
  )
  t.deepEqual(
    writer.opts,
    { appending: true, gzip: false },
    'WARCWriterBase when options are supplied (appending: true) should set appending to true but not gzip'
  )
})

test('initWARC should init the warc and be in gzip mode when the options state to gzip', t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc', { gzip: true })
  const { path, options } = writer._warcOutStream
  t.is(
    path,
    'dummy.warc',
    'the path WARCWriterBase should have used is dummy.warc'
  )
  t.deepEqual(
    options,
    { encoding: 'utf8' },
    'WARCWriterBase should have used the default opts'
  )
  t.deepEqual(
    writer.opts,
    { appending: false, gzip: true },
    'WARCWriterBase when options are supplied (gzip: true) should set gzip to true but not appending'
  )
})

test('writeRecordChunks should just write the buffer chunks', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeRecordChunks(
    Buffer.from([]),
    Buffer.from([]),
    Buffer.from([])
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    3,
    'WARCWriterBase should have only called writestream.write 3x'
  )
  t.true(
    checkingWOS.writeSequence.every(
      b => b.buffer.length === 0 && b.encoding === 'utf8'
    ),
    'No additional content should have been added'
  )
})

test('writeWarcInfoRecord should write a correct info record', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeWarcInfoRecord(
    'testing',
    'createdByTesting',
    'superduper awesome browser'
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.true(buffer != null, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  t.is(
    (bufferString.match(crlfRe) || []).length,
    16,
    'The written record should only contain 16 CRLFs'
  )
  t.true(
    bufferString.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'warcinfo', 'The warc type should be info')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '177',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['WARC-Filename'],
    'dummy.warc',
    'the warc filename field should be dummy.warc'
  )
  t.is(parsed['isPartOf'], 'testing', 'isPartOf should be "testing"')
  t.is(
    parsed['description'],
    'createdByTesting',
    'description should be "createdByTesting"'
  )
  t.is(
    parsed['http-header-user-agent'],
    'superduper awesome browser',
    'http-header-user-agent should be "superduper awesome browser"'
  )
})

test('writeWarcRawInfoRecord should write a correct info record', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeWarcRawInfoRecord('')
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.true(buffer != null, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  t.is(
    (bufferString.match(crlfRe) || []).length,
    9,
    'The written info record with empty content should only contain 9 CRLFs'
  )
  t.true(
    bufferString.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'warcinfo', 'The warc type should be info')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '0',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['WARC-Filename'],
    'dummy.warc',
    'the warc filename field should be dummy.warc'
  )
})

test('writeWarcMetadataOutlinks should write a correct metadata record when no warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const turi = 'http://example.com'
  const outlinks = 'outlinks: https://example.cm\nhttps://bar.example.com'
  await writer.writeWarcMetadataOutlinks(turi, outlinks)
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(buffer, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'metadata', 'The warc type should be metadata')
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '54',
    'something is wrong with the headers field content-length'
  )
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.is(
    parsed['Content-Type'],
    'application/warc-fields',
    'something is wrong with the headers field content-type'
  )
  t.is(
    parsed['outlinks'],
    outlinks.split(': ')[1],
    'something is wrong with the outlinks'
  )
})

test('writeWarcMetadataOutlinks should write a correct metadata record when a warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const winfoId = uuid()
  writer._warcInfoId = winfoId
  const turi = 'http://example.com'
  const outlinks = 'outlinks: https://example.cm\nhttps://bar.example.com'
  await writer.writeWarcMetadataOutlinks(turi, outlinks)
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(buffer, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'metadata', 'The warc type should be info')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '54',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['WARC-Concurrent-To'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Concurrent-To field should be equal to the warc info records id if one was previously written exists'
  )
  t.is(
    parsed['Content-Type'],
    'application/warc-fields',
    'something is wrong with the headers field content-type'
  )
  t.is(
    parsed['outlinks'],
    outlinks.split(': ')[1],
    'something is wrong with the outlinks'
  )
})

test('writeWarcMetadata should write a correct metadata record when no warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const turi = 'http://example.com'
  const outlinks = 'outlinks: https://example.cm\nhttps://bar.example.com'
  await writer.writeWarcMetadata(turi, outlinks)
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(buffer, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'metadata', 'The warc type should be metadata')
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '54',
    'something is wrong with the headers field content-length'
  )
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.is(
    parsed['Content-Type'],
    'application/warc-fields',
    'something is wrong with the headers field content-type'
  )
  t.is(
    parsed['outlinks'],
    outlinks.split(': ')[1],
    'something is wrong with the outlinks'
  )
})

test('writeWarcMetadata should write a correct metadata record when a warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const winfoId = uuid()
  writer._warcInfoId = winfoId
  const turi = 'http://example.com'
  const outlinks = 'outlinks: https://example.cm\nhttps://bar.example.com'
  await writer.writeWarcMetadata(turi, outlinks)
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write once'
  )
  const { buffer, encoding } = checkingWOS.getAWrite()
  t.is(
    encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(buffer, 'The buffer written should not be null')
  const bufferString = buffer.toString()
  const parsed = parseWrittenInfoMdataRecord(bufferString)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'metadata', 'The warc type should be info')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '54',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['WARC-Concurrent-To'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Concurrent-To field should be equal to the warc info records id if one was previously written exists'
  )
  t.is(
    parsed['Content-Type'],
    'application/warc-fields',
    'something is wrong with the headers field content-type'
  )
  t.is(
    parsed['outlinks'],
    outlinks.split(': ')[1],
    'something is wrong with the outlinks'
  )
})

test('writeRequestResponseRecords should write correct request and response records when no warc info record was previously written', async t => {
  const resData = await fs.readFile(fakeResponse, 'utf8')
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeRequestResponseRecords(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.reqData,
    { ...fakeReqResHttpData.resData, data: resData }
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    2,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const reqBuffer = checkingWOS.getAWrite()
  t.is(
    reqBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    reqBuffer.buffer,
    'The request record buffer written should not be null'
  )
  const reqBufferStr = reqBuffer.buffer.toString()
  t.is(
    (reqBufferStr.match(crlfRe) || []).length,
    20,
    'The written request record should only contain 20 CRLFs'
  )
  t.true(
    reqBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenRequestRecord(reqBufferStr)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'request', 'The warc type should be request')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '398',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['Content-Type'],
    'application/http; msgtype=request',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(parsed.http, fakeReqResHttpData.reqData.headers)
  const resBuffer = checkingWOS.getAWrite()
  t.is(
    resBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    resBuffer.buffer,
    'The response record buffer written should not be null'
  )
  const resBufferStr = resBuffer.buffer.toString()
  t.is(
    (resBufferStr.match(crlfRe) || []).length,
    21,
    'The written record should only contain 21 CRLFs'
  )
  t.true(
    resBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed2 = parseWrittenResponseRecord(resBufferStr)
  t.is(parsed2['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed2['WARC-Type'], 'response', 'The warc type should be request')
  t.true(
    idRe.test(parsed2['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed2['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed2['Content-Length'],
    '69647',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed2['Content-Type'],
    'application/http; msgtype=response',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(parsed2.http, fakeReqResHttpData.resData.headers)
  t.is(parsed2.body, resData)
})

test('writeRequestResponseRecords should write correct request and response records when a warc info record was previously written', async t => {
  const resData = await fs.readFile(fakeResponse, 'utf8')
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const winfoId = uuid()
  writer._warcInfoId = winfoId
  await writer.writeRequestResponseRecords(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.reqData,
    { ...fakeReqResHttpData.resData, data: resData }
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    2,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const reqBuffer = checkingWOS.getAWrite()
  t.is(
    reqBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    reqBuffer.buffer,
    'The request record buffer written should not be null'
  )
  const reqBufferStr = reqBuffer.buffer.toString()
  t.is(
    (reqBufferStr.match(crlfRe) || []).length,
    21,
    'The written request record should only contain 21 CRLFs'
  )
  t.true(
    reqBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenRequestRecord(reqBufferStr)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'request', 'The warc type should be request')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '398',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['Content-Type'],
    'application/http; msgtype=request',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.true(
    idRe.test(parsed['WARC-Warcinfo-ID']),
    'something is wrong with the requests WARC-Warcinfo-ID'
  )
  t.is(
    parsed['WARC-Warcinfo-ID'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Warcinfo-ID field of the request record should be equal to the warc info records id if one was previously written exists'
  )
  t.is(parsed.http, fakeReqResHttpData.reqData.headers)
  const resBuffer = checkingWOS.getAWrite()
  t.is(
    resBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    resBuffer.buffer,
    'The response record buffer written should not be null'
  )
  const resBufferStr = resBuffer.buffer.toString()
  t.is(
    (resBufferStr.match(crlfRe) || []).length,
    22,
    'The written response record should only contain 22 CRLFs'
  )
  t.true(
    resBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed2 = parseWrittenResponseRecord(resBufferStr)
  t.is(
    parsed['WARC-Concurrent-To'],
    parsed2['WARC-Record-ID'],
    'the request record should be concurrent to the response records id'
  )
  t.true(
    idRe.test(parsed['WARC-Concurrent-To']),
    'something is wrong with the requests WARC-Concurrent-To'
  )
  t.is(parsed2['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed2['WARC-Type'], 'response', 'The warc type should be request')
  t.true(
    idRe.test(parsed2['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed2['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed2['Content-Length'],
    '69647',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed2['Content-Type'],
    'application/http; msgtype=response',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(
    parsed2['WARC-Warcinfo-ID'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Warcinfo-ID field of the response record should be equal to the warc info records id if one was previously written exists'
  )
  t.true(
    idRe.test(parsed2['WARC-Warcinfo-ID']),
    'something is wrong with the responses WARC-Warcinfo-ID'
  )
  t.is(parsed2.http, fakeReqResHttpData.resData.headers)
  t.is(parsed2.body, resData)
})

test('writeRequestRecord should write correct request when no warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeRequestRecord(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.reqData.headers,
    fakeReqResHttpData.reqData.data
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const reqBuffer = checkingWOS.getAWrite()
  t.is(
    reqBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    reqBuffer.buffer,
    'The request record buffer written should not be null'
  )
  const reqBufferStr = reqBuffer.buffer.toString()
  t.is(
    (reqBufferStr.match(crlfRe) || []).length,
    19,
    'The written request record should only contain 19 CRLFs'
  )
  t.true(
    reqBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenRequestRecord(reqBufferStr)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'request', 'The warc type should be request')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '398',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['Content-Type'],
    'application/http; msgtype=request',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(parsed.http, fakeReqResHttpData.reqData.headers)
})

test('writeRequestRecord should write correct request when a warc info record was previously written', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const winfoId = uuid()
  writer._warcInfoId = winfoId
  await writer.writeRequestRecord(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.reqData.headers,
    fakeReqResHttpData.reqData.data
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const reqBuffer = checkingWOS.getAWrite()
  t.is(
    reqBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    reqBuffer.buffer,
    'The request record buffer written should not be null'
  )
  const reqBufferStr = reqBuffer.buffer.toString()
  t.is(
    (reqBufferStr.match(crlfRe) || []).length,
    20,
    'The written request record should only contain 20 CRLFs'
  )
  t.true(
    reqBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed = parseWrittenRequestRecord(reqBufferStr)
  t.is(parsed['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed['WARC-Type'], 'request', 'The warc type should be request')
  t.true(
    idRe.test(parsed['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed['Content-Length'],
    '398',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed['Content-Type'],
    'application/http; msgtype=request',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(
    parsed['WARC-Warcinfo-ID'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Warcinfo-ID field of the request record should be equal to the warc info records id if one was previously written exists'
  )
  t.is(parsed.http, fakeReqResHttpData.reqData.headers)
})

test('writeResponseRecord should write correct response when no warc info record was previously written', async t => {
  const resData = await fs.readFile(fakeResponse, 'utf8')
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeResponseRecord(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.resData.headers,
    resData
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const resBuffer = checkingWOS.getAWrite()
  t.is(
    resBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    resBuffer.buffer,
    'The response record buffer written should not be null'
  )
  const resBufferStr = resBuffer.buffer.toString()
  t.is(
    (resBufferStr.match(crlfRe) || []).length,
    21,
    'The written record should only contain 21 CRLFs'
  )
  t.true(
    resBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed2 = parseWrittenResponseRecord(resBufferStr)
  t.is(parsed2['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed2['WARC-Type'], 'response', 'The warc type should be request')
  t.true(
    idRe.test(parsed2['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed2['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed2['Content-Length'],
    '69647',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed2['Content-Type'],
    'application/http; msgtype=response',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(parsed2.http, fakeReqResHttpData.resData.headers)
  t.is(parsed2.body, resData)
})

test('writeResponseRecord should write correct response when a warc info record was previously written', async t => {
  const resData = await fs.readFile(fakeResponse, 'utf8')
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  const winfoId = uuid()
  writer._warcInfoId = winfoId
  await writer.writeResponseRecord(
    fakeReqResHttpData.targetURI,
    fakeReqResHttpData.resData.headers,
    resData
  )
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write twice'
  )
  const resBuffer = checkingWOS.getAWrite()
  t.is(
    resBuffer.encoding,
    'utf8',
    'The encoding of the warc info record written should be utf8'
  )
  t.truthy(
    resBuffer.buffer,
    'The response record buffer written should not be null'
  )
  const resBufferStr = resBuffer.buffer.toString()
  t.is(
    (resBufferStr.match(crlfRe) || []).length,
    22,
    'The written response record should only contain 22 CRLFs'
  )
  t.true(
    resBufferStr.endsWith('\r\n\r\n'),
    'The written record should end with 2 CRLFs'
  )
  const parsed2 = parseWrittenResponseRecord(resBufferStr)
  t.is(parsed2['WARC'], '1.1', 'The warc version should be 1.1')
  t.is(parsed2['WARC-Type'], 'response', 'The warc type should be request')
  t.true(
    idRe.test(parsed2['WARC-Record-ID']),
    'something is wrong with the warc record id'
  )
  t.true(
    dateRe.test(parsed2['WARC-Date']),
    'something is wrong with the warc date field'
  )
  t.is(
    parsed2['Content-Length'],
    '69647',
    'something is wrong with the headers field content-length'
  )
  t.is(
    parsed2['Content-Type'],
    'application/http; msgtype=response',
    'Something is wrong with the warc content type'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.is(
    parsed2['WARC-Target-URI'],
    fakeReqResHttpData.targetURI,
    'WARC-Target-URI for the request record should match the supplied target URI'
  )
  t.true(
    idRe.test(parsed2['WARC-Warcinfo-ID']),
    'something is wrong with the responses WARC-Warcinfo-ID'
  )
  t.is(
    parsed2['WARC-Warcinfo-ID'],
    `<urn:uuid:${winfoId}>`,
    'The WARC-Warcinfo-ID field of the response record should be equal to the warc info records id if one was previously written exists'
  )
  t.is(parsed2.http, fakeReqResHttpData.resData.headers)
  t.is(parsed2.body, resData)
})

test('writeRecordBlock should just write the buffer', async t => {
  const { writer } = t.context
  writer.initWARC('dummy.warc')
  await writer.writeRecordBlock(Buffer.from([]))
  const checkingWOS = writer._warcOutStream
  t.is(
    checkingWOS.numWrites(),
    1,
    'WARCWriterBase should have only called writestream.write 1x'
  )
  t.true(
    checkingWOS.writeSequence.every(
      b => b.buffer.length === 0 && b.encoding === 'utf8'
    ),
    'No additional content should have been added'
  )
})
