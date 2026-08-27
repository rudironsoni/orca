// Leftover pre-commit tries `swift package lefthook`, which writes `.build/`
// into every temp git repo and shadows real git errors. Skip leftover when
// it is not this repo's hook.
process.env.LEFTHOOK ??= '0'
