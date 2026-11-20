// lap-calendar (contrato 60, convites-agenda): o canal do LAP Reuniões com o Calendário do Mac, pelo EventKit. Só
// grava com `create`, `update` ou `remove` explícitos, e só o que a requisição diz; nunca mexe em agenda, lembrete ou
// alarme, e não usa rede (a sincronia com iCloud, Google e Exchange é do próprio Calendário).
//
// Protocolo (docs/specs/desktop-shell/contracts/60-convites-helper-calendario.md): uma requisição JSON por linha no
// stdin, `{"v":1,"id":"a1","cmd":"status","args":{}}`, e uma resposta por linha no stdout, com as chaves em ordem
// alfabética: `{"id":"a1","ok":true,"result":{…},"v":1}` ou `{"error":{"code","message","reason"},"id",…}`. Uma
// requisição por vez, na ordem de chegada; nenhuma linha sai sem requisição. O stderr é só diagnóstico.
//
// Permissão: o TCC cobra a do app responsável (o LAP Reuniões, processo pai), com a frase do Info.plist dele; o
// Info.plist embutido aqui (native/calendar/Info.plist, `-sectcreate __TEXT __info_plist`) dá a identidade e a mesma
// frase. Só `request-access` pede acesso, e só quando o macOS ainda não decidiu.
//
// Sai quando o stdin fecha (o app morreu), esperando no máximo 1 s a requisição em andamento. Único argumento:
// `--version`, que não toca no EventKit.
//
// Compilar (os mesmos argumentos do pack.sh e do dev, MAC_CALENDAR_SWIFTC_ARGS em src/main/mac-calendar/process.ts):
//   swiftc -O -target arm64-apple-macos14.4 -warnings-as-errors -Xlinker -sectcreate -Xlinker __TEXT \
//     -Xlinker __info_plist -Xlinker native/calendar/Info.plist native/calendar/main.swift -o lap-calendar
import EventKit
import Foundation

let version = "lap-calendar 1"

let arguments = CommandLine.arguments.dropFirst()
if arguments == ["--version"] {
  print(version)
  exit(0)
}
if !arguments.isEmpty {
  FileHandle.standardError.write(Data("uso: lap-calendar [--version]\n".utf8))
  exit(64)
}

// MARK: Limites (iguais aos de src/main/mac-calendar/protocol.ts e do helper falso)

let maxRequestLine = 64 * 1024
let maxResponseLine = 1024 * 1024
let maxTitle = 1024
let maxLocation = 1024
let maxNotes = 4000
let maxURL = 2048
let maxExdates = 500
let maxMatches = 50
let maxRecurrenceList = 366
let day: TimeInterval = 86_400

// MARK: Erros

struct Failure: Error {
  let code: String
  let reason: String
  let message: String
  /** Os ids do que ficou gravado apesar do erro (EXDATE que falhou depois de salvar); só com `unavailable`/`eventkit`. */
  var saved: [String: Any]? = nil
}

/** O erro do EventKit depois de a série já estar salva: `unavailable`/`eventkit` com os ids do que ficou gravado. */
func savedFailure(_ event: EKEvent, _ what: String, _ error: Error) -> Failure {
  Failure(code: "unavailable", reason: "eventkit", message: "\(what) \(error.localizedDescription)", saved: [
    "eventIdentifier": optional(event.eventIdentifier),
    "calendarItemIdentifier": event.calendarItemIdentifier,
    "externalIdentifier": optional(event.calendarItemExternalIdentifier),
  ])
}

func invalid(_ reason: String, _ message: String) -> Failure { Failure(code: "invalid", reason: reason, message: message) }
func schema(_ message: String) -> Failure { invalid("schema", message) }
func recurrenceError(_ message: String) -> Failure { invalid("recurrence", message) }

// MARK: Leitura do JSON

/** Booleano de verdade: o JSONSerialization devolve NSNumber também para 0 e 1, e `as? Bool` aceitaria os dois. */
func isBool(_ value: Any) -> Bool {
  guard let number = value as? NSNumber else { return false }
  return CFGetTypeID(number) == CFBooleanGetTypeID()
}

/** Um objeto JSON com as chaves conferidas: nenhuma fora de `allowed`, todas as de `required`. */
struct Fields {
  let dict: [String: Any]
  let fail: (String) -> Failure

  init(_ value: Any?, allowed: Set<String>, required: Set<String> = [], fail: @escaping (String) -> Failure = schema) throws {
    guard let value, !isBool(value), let dict = value as? [String: Any] else { throw fail("Era esperado um objeto.") }
    for key in dict.keys where !allowed.contains(key) { throw fail("Chave desconhecida: \(key).") }
    for key in required where dict[key] == nil { throw fail("Falta a chave \(key).") }
    self.dict = dict
    self.fail = fail
  }

  func has(_ key: String) -> Bool { dict[key] != nil }
  func isNull(_ key: String) -> Bool { dict[key] is NSNull }

  func string(_ key: String, min: Int = 0, max: Int) throws -> String? {
    guard let raw = dict[key] else { return nil }
    guard let text = raw as? String else { throw fail("\(key) não é texto.") }
    let length = text.utf16.count
    guard length >= min, length <= max else { throw fail("\(key) fora do tamanho.") }
    return text
  }

  func requiredString(_ key: String, min: Int = 0, max: Int) throws -> String {
    guard let text = try string(key, min: min, max: max) else { throw fail("Falta a chave \(key).") }
    return text
  }

  /** Texto ou `null` (a chave tem de existir). */
  func nullableString(_ key: String, max: Int) throws -> String? {
    if isNull(key) { return nil }
    return try requiredString(key, max: max)
  }

  func bool(_ key: String) throws -> Bool? {
    guard let raw = dict[key] else { return nil }
    guard isBool(raw), let value = raw as? Bool else { throw fail("\(key) não é booleano.") }
    return value
  }

  func requiredBool(_ key: String) throws -> Bool {
    guard let value = try bool(key) else { throw fail("Falta a chave \(key).") }
    return value
  }

  func oneOf(_ key: String, _ options: Set<String>) throws -> String? {
    guard let text = try string(key, max: 64) else { return nil }
    guard options.contains(text) else { throw fail("\(key) com valor desconhecido.") }
    return text
  }

  func array(_ key: String, max: Int) throws -> [Any]? {
    guard let raw = dict[key] else { return nil }
    guard let list = raw as? [Any] else { throw fail("\(key) não é lista.") }
    guard list.count <= max else { throw fail("\(key) com itens demais.") }
    return list
  }
}

/** Inteiro em `range`; `exclude` fica de fora (o 0 das posições). */
func integer(_ raw: Any, _ range: ClosedRange<Int>, exclude: Int? = nil, fail: (String) -> Failure) throws -> Int {
  guard !isBool(raw), let number = raw as? NSNumber else { throw fail("Era esperado um número inteiro.") }
  let double = number.doubleValue
  guard double.rounded() == double, double >= Double(range.lowerBound), double <= Double(range.upperBound) else { throw fail("Número fora do limite.") }
  let value = Int(double)
  if let exclude, value == exclude { throw fail("Número fora do limite.") }
  return value
}

func validID(_ text: String) -> Bool {
  let utf8 = text.utf8
  guard (1...64).contains(utf8.count) else { return false }
  return utf8.allSatisfy { byte in
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || byte == 0x2D || byte == 0x5F
  }
}

// MARK: Datas (N11)

let utc = TimeZone(identifier: "UTC")!
let gregorianUTC: Calendar = {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = utc
  return calendar
}()
/** Dia inteiro: a meia-noite é a do fuso do Mac. Gregoriano sempre (o calendário da pessoa pode ser outro). */
func gregorianLocal() -> Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone.current
  return calendar
}

/** Um `start`/`end`: instante UTC (evento com hora) ou data (dia inteiro). */
enum When: Equatable {
  case instant(Date)
  case date(year: Int, month: Int, day: Int)

  var isDate: Bool {
    if case .date = self { return true }
    return false
  }

  /** O instante no EventKit: o próprio, ou a meia-noite local da data. */
  var moment: Date {
    switch self {
    case .instant(let date): return date
    case .date(let year, let month, let day):
      return gregorianLocal().date(from: DateComponents(year: year, month: month, day: day)) ?? Date(timeIntervalSince1970: 0)
    }
  }

  var text: String {
    switch self {
    case .instant(let date): return formatInstant(date)
    case .date(let year, let month, let day): return String(format: "%04d-%02d-%02d", year, month, day)
    }
  }
}

func digits(_ bytes: ArraySlice<UInt8>) -> Int? {
  guard !bytes.isEmpty, bytes.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
  return bytes.reduce(0) { $0 * 10 + Int($1 - 0x30) }
}

func validDay(_ year: Int, _ month: Int, _ day: Int) -> Bool {
  guard (1...9999).contains(year), (1...12).contains(month), day >= 1 else { return false }
  let components = DateComponents(year: year, month: month, day: day)
  return components.isValidDate(in: gregorianUTC)
}

/** `YYYY-MM-DD` ou `YYYY-MM-DDTHH:MM:SS(.fração)?Z`; a fração é descartada. */
func parseWhen(_ text: String) -> When? {
  let bytes = Array(text.utf8)
  guard bytes.count >= 10, bytes[4] == 0x2D, bytes[7] == 0x2D,
        let year = digits(bytes[0..<4]), let month = digits(bytes[5..<7]), let dayOfMonth = digits(bytes[8..<10]),
        validDay(year, month, dayOfMonth) else { return nil }
  if bytes.count == 10 { return .date(year: year, month: month, day: dayOfMonth) }
  guard bytes.count >= 20, bytes[10] == 0x54, bytes[13] == 0x3A, bytes[16] == 0x3A, bytes.last == 0x5A,
        let hour = digits(bytes[11..<13]), let minute = digits(bytes[14..<16]), let second = digits(bytes[17..<19]),
        hour <= 23, minute <= 59, second <= 59 else { return nil }
  if bytes.count > 20 {
    // Fração de segundo: ".", ao menos um dígito, e o "Z" final.
    guard bytes[19] == 0x2E, bytes.count > 21, digits(bytes[20..<(bytes.count - 1)]) != nil else { return nil }
  } else if bytes[19] != 0x5A {
    return nil
  }
  let components = DateComponents(year: year, month: month, day: dayOfMonth, hour: hour, minute: minute, second: second)
  guard let date = gregorianUTC.date(from: components) else { return nil }
  return .instant(date)
}

func formatInstant(_ date: Date) -> String {
  let parts = gregorianUTC.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
  return String(format: "%04d-%02d-%02dT%02d:%02d:%02dZ", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
}

func formatLocalDay(_ date: Date) -> String {
  let parts = gregorianLocal().dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/** A meia-noite local do dia seguinte: um dia de calendário, não 86.400 s (o dia da troca de horário tem 23 ou 25 h). */
func nextLocalDay(_ midnight: Date) -> Date {
  gregorianLocal().date(byAdding: .day, value: 1, to: midnight) ?? midnight.addingTimeInterval(day)
}

/**
 * Dia inteiro no EventKit: `startDate` é a meia-noite local do `start` e `endDate` a meia-noite local do último dia
 * (`end` − 1 dia de calendário; o `end` do protocolo é exclusivo). Pura e conferida antes da permissão, para o teste
 * com `LAP_CALENDAR_REAL=1` e `TZ` de um fuso com horário de verão pegar a conta errada sem gravar nada.
 */
func allDayRange(start: When, end: When) throws -> (start: Date, end: Date) {
  let startDate = start.moment
  guard let last = gregorianLocal().date(byAdding: .day, value: -1, to: end.moment), last >= startDate else { throw invalid("dates", "O fim tem de vir depois do início.") }
  return (startDate, last)
}

/** Um valor de data com o formato que `allDay` pede (data no dia inteiro, instante com hora). */
func when(_ fields: Fields, _ key: String, allDay: Bool) throws -> When? {
  guard let text = try fields.string(key, max: 64) else { return nil }
  guard let value = parseWhen(text), value.isDate == allDay else { throw schema("\(key) fora do formato.") }
  return value
}

func requiredWhen(_ fields: Fields, _ key: String, allDay: Bool) throws -> When {
  guard let value = try when(fields, key, allDay: allDay) else { throw schema("Falta a chave \(key).") }
  return value
}

// MARK: Recorrência (N8)

let weekdays: [String: EKWeekday] = ["MO": .monday, "TU": .tuesday, "WE": .wednesday, "TH": .thursday, "FR": .friday, "SA": .saturday, "SU": .sunday]
let frequencies: [String: EKRecurrenceFrequency] = ["daily": .daily, "weekly": .weekly, "monthly": .monthly, "yearly": .yearly]

/**
 * O `Recurrence` do protocolo como `EKRecurrenceRule`. Qualquer erro aqui dentro é `invalid`/`recurrence`. O
 * `weekStart` é aceito e não chega ao EventKit: o `EKRecurrenceRule` não recebe o primeiro dia da semana.
 */
func recurrenceRule(_ raw: Any?) throws -> EKRecurrenceRule {
  let rule = try Fields(raw, allowed: ["freq", "interval", "count", "until", "byDay", "byMonthDay", "byMonth", "bySetPos", "weekStart"], required: ["freq"], fail: recurrenceError)
  guard let freqName = try rule.oneOf("freq", Set(frequencies.keys)), let frequency = frequencies[freqName] else { throw recurrenceError("freq desconhecida.") }
  let interval = try rule.dict["interval"].map { try integer($0, 1...999, fail: recurrenceError) } ?? 1
  if rule.has("count"), rule.has("until") { throw recurrenceError("count e until juntos.") }
  var end: EKRecurrenceEnd?
  if let raw = rule.dict["count"] { end = EKRecurrenceEnd(occurrenceCount: try integer(raw, 1...999, fail: recurrenceError)) }
  if let text = try rule.string("until", max: 64) {
    guard let until = parseWhen(text) else { throw recurrenceError("until fora do formato.") }
    // Data: vale o dia inteiro (UNTIL do iCalendar é inclusivo), até 1 s antes da meia-noite local seguinte.
    end = EKRecurrenceEnd(end: until.isDate ? nextLocalDay(until.moment).addingTimeInterval(-1) : until.moment)
  }
  var daysOfWeek: [EKRecurrenceDayOfWeek]?
  if let list = try rule.array("byDay", max: maxRecurrenceList) {
    daysOfWeek = try list.map { item in
      let entry = try Fields(item, allowed: ["day", "pos"], required: ["day"], fail: recurrenceError)
      guard let name = try entry.oneOf("day", Set(weekdays.keys)), let weekday = weekdays[name] else { throw recurrenceError("day desconhecido.") }
      guard let raw = entry.dict["pos"] else { return EKRecurrenceDayOfWeek(weekday) }
      if frequency == .daily || frequency == .weekly { throw recurrenceError("byDay com pos só na repetição mensal ou anual.") }
      return EKRecurrenceDayOfWeek(weekday, weekNumber: try integer(raw, -53...53, exclude: 0, fail: recurrenceError))
    }
  }
  let monthDays = try rule.array("byMonthDay", max: maxRecurrenceList)?.map { NSNumber(value: try integer($0, -31...31, exclude: 0, fail: recurrenceError)) }
  let months = try rule.array("byMonth", max: 12)?.map { NSNumber(value: try integer($0, 1...12, fail: recurrenceError)) }
  let setPositions = try rule.array("bySetPos", max: maxRecurrenceList)?.map { NSNumber(value: try integer($0, -366...366, exclude: 0, fail: recurrenceError)) }
  if setPositions != nil, frequency != .monthly, frequency != .yearly { throw recurrenceError("bySetPos só na repetição mensal ou anual.") }
  _ = try rule.oneOf("weekStart", Set(weekdays.keys))
  return EKRecurrenceRule(recurrenceWith: frequency, interval: interval, daysOfTheWeek: daysOfWeek, daysOfTheMonth: monthDays, monthsOfTheYear: months, weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: setPositions, end: end)
}

// MARK: EventKit

var storage: EKEventStore?
/** Uma loja só, criada na primeira requisição que precisa dela (nunca no `--version`). */
func store() -> EKEventStore {
  if let storage { return storage }
  let created = EKEventStore()
  storage = created
  return created
}

/** O `.authorized` antigo tem o mesmo valor do `.fullAccess` (é um apelido no EventKit), então cai no mesmo caso. */
func accessName() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .fullAccess: return "full"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "denied"
  }
}

/** Os comandos que leem ou gravam precisam do acesso completo; sem ele, nada é lido nem gravado (R8, D2). */
func requireFullAccess() throws {
  switch accessName() {
  case "full": return
  case "restricted": throw Failure(code: "restricted", reason: "restricted", message: "O acesso ao Calendário está restrito neste Mac.")
  case "notDetermined": throw Failure(code: "denied", reason: "not-determined", message: "O acesso ao Calendário ainda não foi pedido.")
  case "writeOnly": throw Failure(code: "denied", reason: "write-only", message: "O acesso ao Calendário é só para adicionar eventos.")
  default: throw Failure(code: "denied", reason: "denied", message: "O acesso ao Calendário foi negado.")
  }
}

final class AccessAnswer: @unchecked Sendable {
  var granted = false
}

func requestAccess() -> [String: Any] {
  guard accessName() == "notDetermined" else { return ["access": accessName(), "granted": accessName() == "full"] }
  let answer = AccessAnswer()
  let done = DispatchSemaphore(value: 0)
  store().requestFullAccessToEvents { granted, _ in
    answer.granted = granted
    done.signal()
  }
  done.wait()
  // A loja criada antes da resposta passa a enxergar as agendas.
  if answer.granted { store().reset() }
  return ["access": accessName(), "granted": answer.granted && accessName() == "full"]
}

func sourceTypeName(_ type: EKSourceType?) -> String {
  switch type {
  case .exchange: return "exchange"
  case .calDAV: return "caldav"
  case .mobileMe: return "mobileme"
  case .subscribed: return "subscribed"
  case .birthdays: return "birthdays"
  default: return "local"
  }
}

func availabilityNames(_ mask: EKCalendarEventAvailabilityMask) -> [String] {
  var names: [String] = []
  if mask.contains(.busy) { names.append("busy") }
  if mask.contains(.tentative) { names.append("tentative") }
  if mask.contains(.free) { names.append("free") }
  if mask.contains(.unavailable) { names.append("unavailable") }
  return names
}

func colorHex(_ color: CGColor?) -> Any {
  guard let color, let srgb = CGColorSpace(name: CGColorSpace.sRGB),
        let converted = color.converted(to: srgb, intent: .defaultIntent, options: nil),
        let components = converted.components, components.count >= 3 else { return NSNull() }
  let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
  return String(format: "#%02X%02X%02X", byte(components[0]), byte(components[1]), byte(components[2]))
}

func calendarsResult() -> [String: Any] {
  let defaultID = store().defaultCalendarForNewEvents?.calendarIdentifier
  let list = store().calendars(for: .event)
    .sorted { ($0.source?.title ?? "", $0.title) < ($1.source?.title ?? "", $1.title) }
    .map { calendar -> [String: Any] in
      [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "sourceId": calendar.source?.sourceIdentifier ?? "",
        "sourceTitle": calendar.source?.title ?? "",
        "sourceType": sourceTypeName(calendar.source?.sourceType),
        "writable": calendar.allowsContentModifications,
        "availabilities": availabilityNames(calendar.supportedEventAvailabilities),
        "color": colorHex(calendar.cgColor),
        "isDefault": calendar.calendarIdentifier == defaultID,
      ]
    }
  return ["calendars": list]
}

func availabilityName(_ availability: EKEventAvailability) -> String {
  switch availability {
  case .busy: return "busy"
  case .tentative: return "tentative"
  case .free: return "free"
  case .unavailable: return "unavailable"
  default: return "none"
  }
}

/** A ocorrência de um evento no formato do `start` dele; `null` fora de série. */
func occurrenceText(_ event: EKEvent) -> String? {
  guard event.hasRecurrenceRules || event.isDetached, let date = event.occurrenceDate as Date? else { return nil }
  return event.isAllDay ? formatLocalDay(date) : formatInstant(date)
}

func startText(_ event: EKEvent) -> String {
  event.isAllDay ? formatLocalDay(event.startDate) : formatInstant(event.startDate)
}

/** Dia inteiro: o EventKit guarda o fim dentro do último dia; o protocolo devolve o dia seguinte (exclusivo). */
func endText(_ event: EKEvent) -> String {
  guard event.isAllDay else { return formatInstant(event.endDate) }
  return formatLocalDay(nextLocalDay(gregorianLocal().startOfDay(for: event.endDate)))
}

func optional(_ value: String?) -> Any { value.map { $0 as Any } ?? NSNull() }

func eventOut(_ event: EKEvent) -> [String: Any] {
  [
    "eventIdentifier": optional(event.eventIdentifier),
    "calendarItemIdentifier": event.calendarItemIdentifier,
    "externalIdentifier": optional(event.calendarItemExternalIdentifier),
    "calendarId": event.calendar?.calendarIdentifier ?? "",
    "calendarTitle": event.calendar?.title ?? "",
    "sourceTitle": event.calendar?.source?.title ?? "",
    "title": event.title ?? "",
    "start": startText(event),
    "end": endText(event),
    "allDay": event.isAllDay,
    "timeZone": event.isAllDay ? NSNull() : optional(event.timeZone?.identifier),
    "recurring": event.hasRecurrenceRules,
    "occurrence": optional(occurrenceText(event)),
    "availability": availabilityName(event.availability),
    "url": optional(event.url?.absoluteString),
  ]
}

func events(from start: Date, to end: Date, in calendars: [EKCalendar]?) -> [EKEvent] {
  store().events(matching: store().predicateForEvents(withStart: start, end: end, calendars: calendars))
}

/** A ocorrência de `item` cuja data original é `recurrenceId`, na janela de um dia em volta, na agenda do item. */
func occurrence(of item: EKEvent, at recurrenceId: When) -> EKEvent? {
  guard let calendar = item.calendar else { return nil }
  let around = recurrenceId.moment
  return events(from: around.addingTimeInterval(-day), to: around.addingTimeInterval(day), in: [calendar])
    .first { $0.calendarItemIdentifier == item.calendarItemIdentifier && occurrenceText($0) == recurrenceId.text }
}

/** Os ids do protocolo, na ordem do N3. */
struct Ids {
  let eventIdentifier: String?
  let calendarItemIdentifier: String?
  let externalIdentifier: String?

  init(_ raw: Any?) throws {
    let ids = try Fields(raw, allowed: ["eventIdentifier", "calendarItemIdentifier", "externalIdentifier"])
    eventIdentifier = try ids.string("eventIdentifier", min: 1, max: 1024)
    calendarItemIdentifier = try ids.string("calendarItemIdentifier", min: 1, max: 1024)
    externalIdentifier = try ids.string("externalIdentifier", min: 1, max: 1024)
    if eventIdentifier == nil, calendarItemIdentifier == nil, externalIdentifier == nil { throw schema("ids sem nenhum id.") }
  }
}

/** Cada caminho do N3 que achou alguma coisa, na ordem; o external id pode achar mais de um item. */
func lookups(_ ids: Ids) -> [(match: String, events: [EKEvent])] {
  var found: [(match: String, events: [EKEvent])] = []
  if let id = ids.eventIdentifier, let event = store().event(withIdentifier: id) { found.append(("eventIdentifier", [event])) }
  if let id = ids.calendarItemIdentifier, let event = store().calendarItem(withIdentifier: id) as? EKEvent { found.append(("calendarItemIdentifier", [event])) }
  if let id = ids.externalIdentifier {
    let events = store().calendarItems(withExternalIdentifier: id).compactMap { $0 as? EKEvent }
    if !events.isEmpty { found.append(("externalIdentifier", events)) }
  }
  return found
}

/** `update` e `remove`: só pelos ids, o primeiro que achar; nunca por título, início ou UID. */
func locate(_ ids: Ids) throws -> EKEvent {
  guard let first = lookups(ids).first else { throw Failure(code: "not-found", reason: "event", message: "Não achei o evento na agenda.") }
  guard first.events.count == 1, let event = first.events.first else { throw invalid("ambiguous", "Mais de um evento com esse id.") }
  return event
}

func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/**
 * `find` (CA4, R5a): pelos ids, pelo UID e por título + início exato, em todas as agendas (inclusive as só de
 * leitura). Nunca grava.
 *
 * UID: o D0 não respondeu se o `calendarItemExternalIdentifier` do evento que o Gmail e o Exchange põem na agenda é
 * o UID do convite (caso 2b do contrato). Por isso o UID casa só por igualdade exata, sem transformação nenhuma, e o
 * título + início exato fica como o caminho que vale quando o external id não tem relação com o UID.
 */
func find(_ args: Fields) throws -> [String: Any] {
  let allDay = try args.requiredBool("allDay")
  let uid = try args.requiredString("uid", min: 1, max: 1024)
  let title = try args.requiredString("title", min: 1, max: maxTitle)
  let start = try requiredWhen(args, "start", allDay: allDay)
  let end = try requiredWhen(args, "end", allDay: allDay)
  let ids = try args.has("ids") ? Ids(args.dict["ids"]) : nil
  let recurrenceId = try when(args, "recurrenceId", allDay: allDay)
  try requireFullAccess()

  var matches: [[String: Any]] = []
  var seen = Set<String>()
  func add(_ event: EKEvent, _ match: String) {
    guard matches.count < maxMatches else { return }
    let key = "\(event.calendarItemIdentifier)|\(occurrenceText(event) ?? "")"
    guard seen.insert(key).inserted else { return }
    var out = eventOut(event)
    out["match"] = match
    matches.append(out)
  }
  /** Com `recurrenceId`, vale a ocorrência dele; um item sem essa ocorrência não conta. */
  func resolved(_ event: EKEvent) -> EKEvent? {
    guard let recurrenceId else { return event }
    if occurrenceText(event) == recurrenceId.text { return event }
    return occurrence(of: event, at: recurrenceId)
  }

  if let ids {
    for (match, events) in lookups(ids) {
      let found = events.compactMap(resolved)
      if found.isEmpty { continue }
      found.forEach { add($0, match) }
      break
    }
  }

  let window = events(from: start.moment.addingTimeInterval(-day), to: end.moment.addingTimeInterval(day), in: nil)
    .filter { recurrenceId == nil || occurrenceText($0) == recurrenceId?.text }
  let byUID = window.filter { $0.calendarItemExternalIdentifier == uid }
  byUID.forEach { add($0, "uid") }
  let windowItems = Set(byUID.map(\.calendarItemIdentifier))
  for item in store().calendarItems(withExternalIdentifier: uid).compactMap({ $0 as? EKEvent }) where !windowItems.contains(item.calendarItemIdentifier) {
    if let event = resolved(item) { add(event, "uid") }
  }
  let wanted = trimmed(title)
  for event in window where trimmed(event.title ?? "") == wanted && startText(event) == start.text && event.isAllDay == allDay {
    add(event, "title-start")
  }
  return ["matches": matches]
}

/** O EventKit recusou ao gravar: os casos que o protocolo nomeia; o resto é `unavailable`/`eventkit`. */
func saveFailure(_ error: Error, updating: Bool) -> Failure {
  if let error = error as? EKError {
    switch error.code {
    case .datesInverted, .noStartDate, .noEndDate, .durationGreaterThanRecurrence, .startDateCollidesWithOtherOccurrence: return invalid("dates", "O início e o fim não fecham.")
    case .calendarReadOnly, .calendarIsImmutable, .calendarDoesNotAllowEvents, .sourceDoesNotAllowEvents, .calendarSourceCannotBeModified:
      return updating ? invalid("not-mutable", "O Calendário não deixa mudar este evento.") : invalid("read-only-calendar", "Esta agenda é só de leitura.")
    // O EventKit não tem um "convite não pode ser modificado" à parte: o convite recebido sai como eventNotMutable, e
    // invitesCannotBeMoved é o convite que não troca de agenda.
    case .eventNotMutable, .invitesCannotBeMoved: return invalid("not-mutable", "O Calendário não deixa mudar este evento.")
    case .eventStoreNotAuthorized: return Failure(code: "denied", reason: "denied", message: "O acesso ao Calendário foi negado.")
    default: break
    }
  }
  return Failure(code: "unavailable", reason: "eventkit", message: error.localizedDescription)
}

/** Provisório só onde a agenda aceita (R4); senão ocupado, ou nada se a agenda também não aceita ocupado. */
func applyAvailability(_ requested: String, to event: EKEvent, in calendar: EKCalendar) -> Bool {
  let supported = calendar.supportedEventAvailabilities
  if requested == "tentative", supported.contains(.tentative) {
    event.availability = .tentative
    return false
  }
  if supported.contains(.busy) {
    event.availability = .busy
    return requested != "busy"
  }
  return true
}

/** Os campos de texto e de link que `create` e `update` aceitam. */
func applyText(_ fields: Fields, to event: EKEvent) throws {
  if let title = try fields.string("title", min: 1, max: maxTitle) { event.title = title }
  if let location = try fields.string("location", max: maxLocation) { event.location = location }
  if let notes = try fields.string("notes", max: maxNotes) { event.notes = notes }
  if let text = try fields.string("url", min: 1, max: maxURL) { event.url = try httpURL(text) }
}

func httpURL(_ text: String) throws -> URL {
  guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host != nil else { throw schema("url só http ou https.") }
  return url
}

func timeZone(_ name: String?) throws -> TimeZone? {
  guard let name else { return nil }
  guard let zone = TimeZone(identifier: name) else { throw invalid("timezone", "Fuso desconhecido.") }
  return zone
}

/** Dia inteiro: `endDate` é a meia-noite do último dia (o `end` do protocolo é exclusivo). */
func applyDates(_ event: EKEvent, start: When, end: When, allDay: Bool, zone: TimeZone?) throws {
  guard end.moment > start.moment else { throw invalid("dates", "O fim tem de vir depois do início.") }
  event.isAllDay = allDay
  if allDay {
    let range = try allDayRange(start: start, end: end)
    event.timeZone = nil
    event.startDate = range.start
    event.endDate = range.end
  } else {
    event.timeZone = zone
    event.startDate = start.moment
    event.endDate = end.moment
  }
}

/** Datas dos `exdates` no formato do `start`. */
func exdateList(_ fields: Fields, allDay: Bool) throws -> [When]? {
  guard let list = try fields.array("exdates", max: maxExdates) else { return nil }
  return try list.map { raw in
    guard let text = raw as? String, let value = parseWhen(text), value.isDate == allDay else { throw schema("exdates fora do formato.") }
    return value
  }
}

/** Cada EXDATE tira aquela ocorrência da série salva (`.thisEvent`); a que não existe vai para `missing`. */
func removeExdates(_ exdates: [When], from series: EKEvent) throws -> (removed: [String], missing: [String]) {
  var removed: [String] = []
  var missing: [String] = []
  for exdate in exdates {
    guard let found = occurrence(of: series, at: exdate) else {
      missing.append(exdate.text)
      continue
    }
    try store().remove(found, span: .thisEvent, commit: true)
    removed.append(exdate.text)
  }
  return (removed, missing)
}

/** Lido de novo depois de salvar: os ids podem ter mudado. */
func reread(_ event: EKEvent) -> EKEvent {
  if occurrenceText(event) == nil, let id = event.eventIdentifier, let fresh = store().event(withIdentifier: id) { return fresh }
  _ = event.refresh()
  return event
}

let createKeys: Set<String> = ["calendarId", "title", "start", "end", "allDay", "timeZone", "location", "url", "notes", "availability", "recurrence", "exdates"]

func create(_ args: Fields) throws -> [String: Any] {
  _ = try Fields(args.dict, allowed: createKeys, required: ["calendarId", "title", "start", "end", "allDay", "timeZone", "availability"])
  let calendarId = try args.requiredString("calendarId", min: 1, max: 1024)
  let allDay = try args.requiredBool("allDay")
  let start = try requiredWhen(args, "start", allDay: allDay)
  let end = try requiredWhen(args, "end", allDay: allDay)
  let zoneName = try args.nullableString("timeZone", max: 64)
  if allDay, zoneName != nil { throw schema("Dia inteiro vai sem fuso.") }
  guard let availability = try args.oneOf("availability", ["busy", "tentative"]) else { throw schema("Falta a chave availability.") }
  let rule = try args.has("recurrence") ? recurrenceRule(args.dict["recurrence"]) : nil
  let exdates = try exdateList(args, allDay: allDay)
  if exdates != nil, rule == nil { throw recurrenceError("exdates sem recurrence.") }
  let zone = try timeZone(zoneName)
  guard end.moment > start.moment else { throw invalid("dates", "O fim tem de vir depois do início.") }
  if allDay { _ = try allDayRange(start: start, end: end) }
  let event = EKEvent(eventStore: store())
  try applyText(args, to: event)
  try requireFullAccess()

  guard let calendar = store().calendar(withIdentifier: calendarId), calendar.allowedEntityTypes.contains(.event) else { throw Failure(code: "not-found", reason: "calendar", message: "Não achei essa agenda.") }
  guard calendar.allowsContentModifications else { throw invalid("read-only-calendar", "Esta agenda é só de leitura.") }
  event.calendar = calendar
  try applyDates(event, start: start, end: end, allDay: allDay, zone: zone)
  let fallback = applyAvailability(availability, to: event, in: calendar)
  if let rule { event.recurrenceRules = [rule] }
  do {
    try store().save(event, span: .futureEvents, commit: true)
  } catch {
    store().reset()
    throw saveFailure(error, updating: false)
  }
  var removed: [String] = []
  var missing: [String] = []
  if let exdates {
    do {
      (removed, missing) = try removeExdates(exdates, from: event)
    } catch {
      // Nenhum erro deixa evento gravado: a série sai inteira. Se nem isso der, o erro diz o que ficou na agenda.
      let cause = saveFailure(error, updating: false)
      do {
        try store().remove(event, span: .futureEvents, commit: true)
      } catch let rollback {
        throw savedFailure(event, "A série ficou gravada: um EXDATE falhou e ela não saiu da agenda.", rollback)
      }
      throw cause
    }
  }
  return ["event": eventOut(reread(event)), "availabilityFallback": fallback, "exdatesRemoved": removed, "exdatesMissing": missing]
}

let updateFieldKeys: Set<String> = ["title", "start", "end", "allDay", "timeZone", "location", "url", "notes", "availability", "recurrence", "exdates"]

func update(_ args: Fields) throws -> [String: Any] {
  _ = try Fields(args.dict, allowed: ["ids", "recurrenceId", "span", "fields"], required: ["ids", "span", "fields"])
  let ids = try Ids(args.dict["ids"])
  guard let span = try args.oneOf("span", ["this", "future"]) else { throw schema("Falta a chave span.") }
  let fields = try Fields(args.dict["fields"], allowed: updateFieldKeys)
  if fields.dict.isEmpty { throw schema("fields vazio.") }
  // Validação que não depende do evento: tipos e limites, antes de olhar a agenda.
  let allDayField = try fields.bool("allDay")
  let startRaw = try fields.string("start", max: 64)
  let endRaw = try fields.string("end", max: 64)
  let ridText = try args.string("recurrenceId", max: 64)
  for text in [startRaw, endRaw, ridText].compactMap({ $0 }) where parseWhen(text) == nil { throw schema("Data fora do formato.") }
  // Trocar `allDay` sem as datas novas não tem leitura única (o 62 sempre manda as duas): recusado.
  if allDayField != nil, startRaw == nil || endRaw == nil { throw schema("allDay pede start e end.") }
  let zoneName: String?? = fields.has("timeZone") ? .some(try fields.nullableString("timeZone", max: 64)) : .none
  let availability = try fields.oneOf("availability", ["busy", "tentative"])
  let rule: EKRecurrenceRule?? = fields.has("recurrence") ? .some(fields.isNull("recurrence") ? nil : try recurrenceRule(fields.dict["recurrence"])) : .none
  if ridText != nil, rule != nil { throw recurrenceError("recurrence não vale para uma ocorrência.") }
  let probe = EKEvent(eventStore: store())
  try applyText(fields, to: probe)
  let zone = try timeZone(zoneName ?? nil)
  try requireFullAccess()

  let item = try locate(ids)
  let allDay = allDayField ?? item.isAllDay
  let exdates = try exdateList(fields, allDay: allDay)
  if exdates != nil, ridText != nil { throw recurrenceError("exdates não vale para uma ocorrência.") }
  let willRecur: Bool = switch rule {
  case .some(let value): value != nil
  case .none: item.hasRecurrenceRules
  }
  if exdates != nil, !willRecur { throw recurrenceError("exdates sem recurrence.") }
  if allDay, case .some(.some) = zoneName { throw schema("Dia inteiro vai sem fuso.") }

  var target = item
  var saveSpan: EKSpan = .futureEvents
  if let ridText {
    guard let recurrenceId = parseWhen(ridText), recurrenceId.isDate == item.isAllDay else { throw schema("recurrenceId fora do formato.") }
    guard let found = occurrenceText(item) == recurrenceId.text ? item : occurrence(of: item, at: recurrenceId) else { throw Failure(code: "not-found", reason: "occurrence", message: "Não achei essa ocorrência na agenda.") }
    target = found
    saveSpan = span == "this" ? .thisEvent : .futureEvents
  } else if span == "this", item.hasRecurrenceRules {
    throw schema("span this numa série pede recurrenceId.")
  }
  guard let calendar = target.calendar, calendar.allowsContentModifications else { throw invalid("not-mutable", "O Calendário não deixa mudar este evento.") }

  let start = try startRaw.map { text -> When in
    guard let value = parseWhen(text), value.isDate == allDay else { throw schema("start fora do formato.") }
    return value
  } ?? parseWhen(startText(target))
  let end = try endRaw.map { text -> When in
    guard let value = parseWhen(text), value.isDate == allDay else { throw schema("end fora do formato.") }
    return value
  } ?? parseWhen(endText(target))
  guard let start, let end else { throw invalid("dates", "O início e o fim não fecham.") }
  let keepZone: TimeZone? = allDay ? nil : (zoneName == nil ? target.timeZone : zone)

  try applyText(fields, to: target)
  try applyDates(target, start: start, end: end, allDay: allDay, zone: keepZone)
  var fallback = false
  if let availability { fallback = applyAvailability(availability, to: target, in: calendar) }
  if case .some(let value) = rule { target.recurrenceRules = value.map { [$0] } }
  do {
    try store().save(target, span: saveSpan, commit: true)
  } catch {
    store().reset()
    throw saveFailure(error, updating: true)
  }
  var removed: [String] = []
  var missing: [String] = []
  if let exdates {
    do {
      (removed, missing) = try removeExdates(exdates, from: target)
    } catch {
      throw savedFailure(target, "Os campos foram salvos, mas um EXDATE falhou.", error)
    }
  }
  return ["event": eventOut(reread(target)), "availabilityFallback": fallback, "exdatesRemoved": removed, "exdatesMissing": missing]
}

func remove(_ args: Fields) throws -> [String: Any] {
  _ = try Fields(args.dict, allowed: ["ids", "recurrenceId", "span"], required: ["ids", "span"])
  let ids = try Ids(args.dict["ids"])
  guard let span = try args.oneOf("span", ["this", "future"]) else { throw schema("Falta a chave span.") }
  let ridText = try args.string("recurrenceId", max: 64)
  if let ridText, parseWhen(ridText) == nil { throw schema("recurrenceId fora do formato.") }
  try requireFullAccess()

  let item = try locate(ids)
  var target = item
  var occurrenceOut: Any = NSNull()
  var removeSpan: EKSpan = .futureEvents
  if let ridText {
    guard let recurrenceId = parseWhen(ridText), recurrenceId.isDate == item.isAllDay else { throw schema("recurrenceId fora do formato.") }
    guard let found = occurrenceText(item) == recurrenceId.text ? item : occurrence(of: item, at: recurrenceId) else { throw Failure(code: "not-found", reason: "occurrence", message: "Não achei essa ocorrência na agenda.") }
    target = found
    occurrenceOut = recurrenceId.text
    removeSpan = span == "this" ? .thisEvent : .futureEvents
  } else if span == "this", item.hasRecurrenceRules {
    throw schema("span this numa série pede recurrenceId.")
  }
  guard target.calendar?.allowsContentModifications == true else { throw invalid("not-mutable", "O Calendário não deixa tirar este evento.") }
  let itemId = target.calendarItemIdentifier
  do {
    try store().remove(target, span: removeSpan, commit: true)
  } catch {
    store().reset()
    throw saveFailure(error, updating: true)
  }
  return ["removed": ["calendarItemIdentifier": itemId, "occurrence": occurrenceOut, "span": span]]
}

// MARK: Requisição e resposta

let commands: Set<String> = ["status", "request-access", "calendars", "refresh", "find", "create", "update", "remove"]

func run(_ cmd: String, _ rawArgs: Any?) throws -> [String: Any] {
  switch cmd {
  case "status", "request-access", "calendars", "refresh":
    _ = try Fields(rawArgs, allowed: [])
  default: break
  }
  switch cmd {
  case "status": return ["access": accessName(), "version": version]
  case "request-access": return requestAccess()
  case "calendars":
    try requireFullAccess()
    return calendarsResult()
  case "refresh":
    store().refreshSourcesIfNecessary()
    return ["requestedAt": formatInstant(Date())]
  case "find":
    let args = try Fields(rawArgs, allowed: ["uid", "title", "start", "end", "allDay", "ids", "recurrenceId"], required: ["uid", "title", "start", "end", "allDay"])
    return try find(args)
  case "create": return try create(Fields(rawArgs, allowed: createKeys))
  case "update": return try update(Fields(rawArgs, allowed: ["ids", "recurrenceId", "span", "fields"]))
  default: return try remove(Fields(rawArgs, allowed: ["ids", "recurrenceId", "span"]))
  }
}

func failureLine(_ id: Any, _ failure: Failure) -> [String: Any] {
  var error: [String: Any] = ["code": failure.code, "reason": failure.reason, "message": failure.message]
  if let saved = failure.saved { error["saved"] = saved }
  return ["v": 1, "id": id, "ok": false, "error": error]
}

func handle(_ line: Data) -> [String: Any] {
  guard let json = try? JSONSerialization.jsonObject(with: line, options: [.fragmentsAllowed]) else {
    return failureLine(NSNull(), invalid("json", "A linha não é um JSON."))
  }
  var id: Any = NSNull()
  if let dict = json as? [String: Any], let raw = dict["id"] as? String, validID(raw) { id = raw }
  do {
    let request = try Fields(json, allowed: ["v", "id", "cmd", "args"], required: ["v", "id", "cmd", "args"])
    guard let v = request.dict["v"], (try? integer(v, 1...1, fail: schema)) == 1 else { throw schema("Versão do protocolo desconhecida.") }
    guard id is String else { throw schema("id fora do formato.") }
    guard let cmd = try request.oneOf("cmd", commands) else { throw schema("Falta a chave cmd.") }
    let result = try autoreleasepool { try run(cmd, request.dict["args"]) }
    return ["v": 1, "id": id, "ok": true, "result": result]
  } catch let failure as Failure {
    return failureLine(id, failure)
  } catch {
    return failureLine(id, Failure(code: "unavailable", reason: "eventkit", message: error.localizedDescription))
  }
}

func write(_ response: [String: Any]) {
  let options: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]
  guard var data = try? JSONSerialization.data(withJSONObject: response, options: options) else { return }
  if data.count > maxResponseLine, let fallback = try? JSONSerialization.data(withJSONObject: failureLine(response["id"] ?? NSNull(), Failure(code: "unavailable", reason: "eventkit", message: "A resposta passou do limite.")), options: options) {
    data = fallback
  }
  data.append(0x0A)
  FileHandle.standardOutput.write(data)
}

// MARK: Laço

/** Fila serial: uma requisição por vez, respondida na ordem de chegada. */
let work = DispatchQueue(label: "lap-calendar")

func enqueue(_ line: Data) {
  work.async { write(handle(line)) }
}

func enqueueTooLong() {
  work.async { write(failureLine(NSNull(), invalid("line-too-long", "A linha passou de 64 KiB."))) }
}

Thread.detachNewThread {
  var buffer = Data()
  var discarding = false
  while true {
    let chunk = FileHandle.standardInput.availableData
    if chunk.isEmpty { break }
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 0x0A) {
      let line = buffer[buffer.startIndex..<newline]
      buffer = Data(buffer[(newline + 1)...])
      if discarding {
        discarding = false
        enqueueTooLong()
      } else if line.count > maxRequestLine {
        enqueueTooLong()
      } else if !line.allSatisfy({ $0 == 0x20 || $0 == 0x09 || $0 == 0x0D }) {
        enqueue(Data(line))
      }
    }
    if buffer.count > maxRequestLine {
      discarding = true
      buffer.removeAll()
    }
  }
  // O stdin fechou (o app morreu): espera a requisição em andamento por no máximo 1 s e sai.
  DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(1)) { exit(0) }
  work.async { exit(0) }
}

dispatchMain()
