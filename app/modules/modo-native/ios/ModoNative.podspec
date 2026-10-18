Pod::Spec.new do |s|
  s.name           = 'ModoNative'
  s.version        = '1.0.0'
  s.summary        = 'modo iOS 네이티브 기능(위젯 갱신, 리마인더)'
  s.homepage       = 'https://github.com/yuntyu01/modo'
  s.license        = 'MIT'
  s.author         = 'yuntyu01'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.libraries = 'sqlite3'
end
