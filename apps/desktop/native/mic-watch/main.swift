// lap-mic-watch (contrato 49, aviso-reuniao): diz ao LAP Reuniões quando outro app liga o microfone, para o aviso
// "Começar a transcrever" aparecer também no Zoom, no FaceTime e afins. Só observa estado: não grava nada, não abre o
// microfone e não pede permissão nenhuma.
//
// - Microfone em uso: `kAudioDevicePropertyDeviceIsRunningSomewhere` no dispositivo de entrada padrão (com listener,
//   e listener da troca do dispositivo padrão). Só informativo: o app decide pela lista de processos abaixo, que vale
//   para qualquer microfone.
// - Quais apps: os process objects do HAL (`kAudioHardwarePropertyProcessObjectList`, macOS 14.4+) com
//   `kAudioProcessPropertyIsRunningInput` ligado, pelo `kAudioProcessPropertyBundleID` (sem ele, pelo PID).
// - Câmera, só informativa: `kCMIODevicePropertyDeviceIsRunningSomewhere` em qualquer câmera.
//
// Protocolo: uma linha JSON no stdout por mudança, a primeira com o estado atual:
//   {"v":1,"mic":true,"apps":["us.zoom.xos"],"names":{"us.zoom.xos":"zoom.us"},"camera":false}
// `names` traz o nome do app (o do macOS) de cada bundle id, para o app mostrar quando não conhece o id. Sai sozinho
// quando o stdin fecha (o app morreu). Único argumento: `--version`.
//
// Compilar: swiftc -O -target arm64-apple-macos14.4 main.swift -o lap-mic-watch
import AppKit
import CoreAudio
import CoreMediaIO
import Foundation

let version = "lap-mic-watch 1"

let arguments = CommandLine.arguments.dropFirst()
if arguments == ["--version"] {
  print(version)
  exit(0)
}
if !arguments.isEmpty {
  FileHandle.standardError.write(Data("uso: lap-mic-watch [--version]\n".utf8))
  exit(64)
}

// MARK: CoreAudio

func audioAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

let systemObject = AudioObjectID(kAudioObjectSystemObject)

func readUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var address = audioAddress(selector)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
  return value
}

func defaultInputDevice() -> AudioObjectID? {
  var address = audioAddress(kAudioHardwarePropertyDefaultInputDevice)
  var device = AudioObjectID(kAudioObjectUnknown)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(systemObject, &address, 0, nil, &size, &device) == noErr, device != kAudioObjectUnknown else { return nil }
  return device
}

func processObjects() -> [AudioObjectID] {
  var address = audioAddress(kAudioHardwarePropertyProcessObjectList)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(systemObject, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
  var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(systemObject, &address, 0, nil, &size, &list) == noErr else { return [] }
  return Array(list.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
}

func processPID(_ process: AudioObjectID) -> pid_t? {
  var address = audioAddress(kAudioProcessPropertyPID)
  var pid: pid_t = 0
  var size = UInt32(MemoryLayout<pid_t>.size)
  guard AudioObjectGetPropertyData(process, &address, 0, nil, &size, &pid) == noErr, pid > 0 else { return nil }
  return pid
}

func processBundleID(_ process: AudioObjectID) -> String? {
  var address = audioAddress(kAudioProcessPropertyBundleID)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(process, &address, 0, nil, &size, $0) }
  guard status == noErr, let id = value?.takeRetainedValue() as String?, !id.isEmpty else { return nil }
  return id
}

// MARK: CoreMediaIO (câmera)

func cmioAddress(_ selector: CMIOObjectPropertySelector) -> CMIOObjectPropertyAddress {
  CMIOObjectPropertyAddress(mSelector: selector, mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
}

let cmioSystemObject = CMIOObjectID(kCMIOObjectSystemObject)

func cameraDevices() -> [CMIOObjectID] {
  var address = cmioAddress(CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices))
  var size: UInt32 = 0
  guard CMIOObjectGetPropertyDataSize(cmioSystemObject, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
  var list = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
  var used: UInt32 = 0
  guard CMIOObjectGetPropertyData(cmioSystemObject, &address, 0, nil, size, &used, &list) == noErr else { return [] }
  return Array(list.prefix(Int(used) / MemoryLayout<CMIOObjectID>.size))
}

func cameraRunning(_ device: CMIOObjectID) -> Bool {
  var address = cmioAddress(CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere))
  var value: UInt32 = 0
  var used: UInt32 = 0
  guard CMIOObjectGetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &used, &value) == noErr else { return false }
  return value != 0
}

// MARK: Nome do app

/** Nome do app como o macOS mostra: o do processo, senão o do pacote instalado com esse bundle id. */
func appName(bundleID: String, pid: pid_t?) -> String? {
  if let pid, let name = NSRunningApplication(processIdentifier: pid)?.localizedName, !name.isEmpty { return name }
  guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return nil }
  let name = FileManager.default.displayName(atPath: url.path)
  return name.hasSuffix(".app") ? String(name.dropLast(4)) : name
}

// MARK: Estado

struct Snapshot: Encodable, Equatable {
  let v: Int
  let mic: Bool
  let apps: [String]
  let names: [String: String]
  let camera: Bool
}

let ownPID = getpid()
let encoder: JSONEncoder = {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  return encoder
}()

func snapshot() -> Snapshot {
  // O AppKit (NSRunningApplication, NSWorkspace) devolve objetos autoreleased; sem o pool, eles se acumulam a cada
  // leitura num processo que roda o dia inteiro.
  autoreleasepool { readSnapshot() }
}

func readSnapshot() -> Snapshot {
  let mic = defaultInputDevice().flatMap { readUInt32($0, kAudioDevicePropertyDeviceIsRunningSomewhere) }.map { $0 != 0 } ?? false
  var apps = Set<String>()
  var names: [String: String] = [:]
  for process in processObjects() where readUInt32(process, kAudioProcessPropertyIsRunningInput) == 1 {
    let pid = processPID(process)
    if pid == ownPID { continue }
    guard let id = processBundleID(process) ?? pid.flatMap({ NSRunningApplication(processIdentifier: $0)?.bundleIdentifier }) else { continue }
    apps.insert(id)
    if names[id] == nil, let name = appName(bundleID: id, pid: pid) { names[id] = name }
  }
  let camera = cameraDevices().contains(where: cameraRunning)
  return Snapshot(v: 1, mic: mic, apps: apps.sorted(), names: names, camera: camera)
}

var last: Snapshot?
var pending = false

/** Escreve o estado se mudou. Os listeners chegam em rajada: uma leitura só, 100 ms depois do primeiro. */
func emit() {
  pending = false
  autoreleasepool {
    let now = snapshot()
    if now == last { return }
    last = now
    guard let data = try? encoder.encode(now), var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    fputs(line, stdout)
    fflush(stdout)
  }
}

func schedule() {
  if pending { return }
  pending = true
  DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(100), execute: emit)
}

// MARK: Listeners

let audioListener: AudioObjectPropertyListenerBlock = { _, _ in schedule() }
var watchedInput: AudioObjectID?
var watchedProcesses = Set<AudioObjectID>()

/** O dispositivo de entrada padrão trocou: o listener de "em uso" passa para o novo. */
func watchDefaultInput() {
  let device = defaultInputDevice()
  if device == watchedInput { return }
  var address = audioAddress(kAudioDevicePropertyDeviceIsRunningSomewhere)
  if let old = watchedInput { AudioObjectRemovePropertyListenerBlock(old, &address, DispatchQueue.main, audioListener) }
  watchedInput = device
  if let device { AudioObjectAddPropertyListenerBlock(device, &address, DispatchQueue.main, audioListener) }
}

/** Cada processo novo do HAL ganha o listener de entrada ligada (os que saíram somem sozinhos com o objeto). */
func watchProcesses() {
  let current = Set(processObjects())
  var address = audioAddress(kAudioProcessPropertyIsRunningInput)
  for process in current.subtracting(watchedProcesses) {
    AudioObjectAddPropertyListenerBlock(process, &address, DispatchQueue.main, audioListener)
  }
  watchedProcesses = current
}

var defaultInputAddress = audioAddress(kAudioHardwarePropertyDefaultInputDevice)
AudioObjectAddPropertyListenerBlock(systemObject, &defaultInputAddress, DispatchQueue.main) { _, _ in
  watchDefaultInput()
  schedule()
}
var processListAddress = audioAddress(kAudioHardwarePropertyProcessObjectList)
AudioObjectAddPropertyListenerBlock(systemObject, &processListAddress, DispatchQueue.main) { _, _ in
  watchProcesses()
  schedule()
}
watchDefaultInput()
watchProcesses()

var watchedCameras = Set<CMIOObjectID>()
func watchCameras() {
  var address = cmioAddress(CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere))
  for device in Set(cameraDevices()).subtracting(watchedCameras) {
    CMIOObjectAddPropertyListenerBlock(device, &address, DispatchQueue.main) { _, _ in schedule() }
    watchedCameras.insert(device)
  }
}
var cameraListAddress = cmioAddress(CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices))
CMIOObjectAddPropertyListenerBlock(cmioSystemObject, &cameraListAddress, DispatchQueue.main) { _, _ in
  watchCameras()
  schedule()
}
watchCameras()

// Rede de segurança: um listener perdido não deixa o estado parado (a leitura é barata e só escreve se mudou).
let poll = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
poll.schedule(deadline: .now() + .seconds(2), repeating: .seconds(2))
poll.setEventHandler(handler: schedule)
poll.resume()

// O app morreu (ou parou o observador): o stdin fecha e o processo sai.
Thread.detachNewThread {
  while !FileHandle.standardInput.availableData.isEmpty {}
  exit(0)
}

emit()
dispatchMain()
